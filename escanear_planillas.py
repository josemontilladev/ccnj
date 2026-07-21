# -*- coding: utf-8 -*-
"""
============================================================
 Escáner de planillas — Sistema de Membresía CFNJ
------------------------------------------------------------
 Cómo se usa:
   1. Copia las fotos de las planillas en la carpeta "planillas"
      (se crea sola la primera vez).
   2. Ejecuta este script (doble clic en escanear-planillas.bat).
   3. Abre index.html: los miembros nuevos se importan solos,
      con todos los campos llenos y la foto recortada.

 Usa la clave de Google Gemini configurada en datos.js.
 Cada planilla se procesa una sola vez (registro en
 planillas/registro.json).
============================================================
"""

import base64
import io
import json
import os
import re
import sys
import urllib.request
import urllib.error

try:
    from PIL import Image
except ImportError:
    print("Falta la librería Pillow. Instálala con:  pip install pillow")
    sys.exit(1)

CARPETA = os.path.dirname(os.path.abspath(__file__))
CARPETA_PLANILLAS = os.path.join(CARPETA, "planillas")
REGISTRO = os.path.join(CARPETA_PLANILLAS, "registro.json")
SALIDA_JS = os.path.join(CARPETA, "planillas_extra.js")
DATOS_JS = os.path.join(CARPETA, "datos.js")

MODELOS_GEMINI = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3-flash-preview"]

CLAVES = [
    "nombres", "ci", "fecha_nacimiento", "lugar_nacimiento", "estado_civil", "correo",
    "telefono", "direccion", "ocupacion", "profesion", "esposo", "hijos", "padres",
    "vive_con_padres", "vive_con_esposo_hijos", "recibio_cristo", "bautizo",
    "tiempo_confraternidad", "funcion",
    "foto_ymin", "foto_xmin", "foto_ymax", "foto_xmax",
]

# snake_case (IA) -> nombre de campo en la app
MAPA_CAMPOS = {
    "nombres": "nombres", "ci": "ci", "fecha_nacimiento": "fechaNacimiento",
    "lugar_nacimiento": "lugarNacimiento", "estado_civil": "estadoCivil", "correo": "correo",
    "telefono": "telefono", "direccion": "direccion", "ocupacion": "ocupacion",
    "profesion": "profesion", "esposo": "esposo", "hijos": "hijos", "padres": "padres",
    "vive_con_padres": "viveConPadres", "vive_con_esposo_hijos": "viveConEsposoHijos",
    "recibio_cristo": "recibioCristo", "bautizo": "bautizo",
    "tiempo_confraternidad": "tiempoConfraternidad", "funcion": "funcion",
}

PROMPT = """Esta es una fotografía de una planilla de membresía manuscrita de la iglesia "Confraternidad Cristiana Nueva Jerusalén" (formato MEMBRESÍA). Lee cuidadosamente la letra a mano y extrae todos los campos.

Reglas:
- Si un campo está vacío o es ilegible, devuelve una cadena vacía "" (no inventes datos).
- Transcribe nombres propios con mayúscula inicial (ej: "Juan Carlos Ramos").
- La cédula (C.I.) solo con dígitos y puntos si los tiene.
- El teléfono tal como está escrito.
- "funcion" corresponde a la pregunta "¿Ejerce usted alguna función en la iglesia y desde cuándo?" — extrae solo el nombre de la función, sin la fecha.
- "foto_ymin", "foto_xmin", "foto_ymax", "foto_xmax": coordenadas del recuadro donde está la FOTOGRAFÍA del rostro de la persona pegada o impresa en la planilla, normalizadas de 0 a 1000 respecto a la imagen completa (ymin = borde superior, xmin = izquierdo, ymax = inferior, xmax = derecho), como cadenas numéricas. Ajusta el recuadro solo a la fotografía. Si no hay fotografía, devuelve cadenas vacías en las cuatro.

Responde SOLO con un objeto JSON con exactamente estas claves (todas con valores de texto): """ + ", ".join(CLAVES)


def leer_clave_gemini():
    """Lee la clave de Gemini desde datos.js (PRECONFIG.geminiKey)."""
    try:
        contenido = io.open(DATOS_JS, encoding="utf-8").read()
        m = re.search(r"geminiKey:\s*'([^']+)'", contenido)
        if m and m.group(1).strip():
            return m.group(1).strip()
    except OSError:
        pass
    return None


def imagen_a_base64(ruta, max_dim=2000, calidad=88):
    """Devuelve (base64_jpeg, Image original) reducida para enviar a la IA."""
    img = Image.open(ruta)
    img = img.convert("RGB")
    escala = min(1.0, max_dim / max(img.size))
    envio = img.resize((round(img.width * escala), round(img.height * escala)), Image.LANCZOS) if escala < 1 else img
    buf = io.BytesIO()
    envio.save(buf, "JPEG", quality=calidad)
    return base64.b64encode(buf.getvalue()).decode(), img


def llamar_gemini(clave, b64):
    """Llama a Gemini probando varios modelos; devuelve el dict extraído."""
    cuerpo = json.dumps({
        "contents": [{
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
            ]
        }],
        "generationConfig": {"temperature": 0, "response_mime_type": "application/json"},
    }).encode("utf-8")

    ultimo_error = None
    for modelo in MODELOS_GEMINI:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{modelo}:generateContent?key={urllib.parse.quote(clave)}"
        )
        peticion = urllib.request.Request(
            url, data=cuerpo, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(peticion, timeout=120) as resp:
                datos = json.loads(resp.read().decode("utf-8"))
            partes = datos.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            texto = "".join(p.get("text", "") for p in partes)
            texto = re.sub(r"^```json\s*|```\s*$", "", texto.strip())
            return json.loads(texto)
        except urllib.error.HTTPError as e:
            detalle = e.read().decode("utf-8", "ignore")[:200]
            ultimo_error = f"{modelo}: HTTP {e.code} {detalle}"
            if e.code in (400, 403):  # clave inválida: no insistir con otros modelos
                break
        except Exception as e:  # red, JSON, etc.
            ultimo_error = f"{modelo}: {e}"
    raise RuntimeError(ultimo_error or "sin respuesta de Gemini")


def recortar_foto(img, datos):
    """Recorta la foto de la persona usando las coordenadas de la IA (0-1000)."""
    try:
        ys, xs = float(datos["foto_ymin"]), float(datos["foto_xmin"])
        ye, xe = float(datos["foto_ymax"]), float(datos["foto_xmax"])
    except (ValueError, KeyError, TypeError):
        return None
    if ye - ys < 15 or xe - xs < 15:
        return None
    margen = -10  # encoge un poco el recuadro para no incluir papel alrededor
    x1 = max(0, (xs - margen) / 1000) * img.width
    y1 = max(0, (ys - margen) / 1000) * img.height
    x2 = min(1, (xe + margen) / 1000) * img.width
    y2 = min(1, (ye + margen) / 1000) * img.height
    foto = img.crop((round(x1), round(y1), round(x2), round(y2)))
    ancho = 320
    foto = foto.resize((ancho, round(foto.height * ancho / foto.width)), Image.LANCZOS)
    buf = io.BytesIO()
    foto.save(buf, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def cargar_registro():
    if os.path.exists(REGISTRO):
        try:
            return json.load(io.open(REGISTRO, encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return {}


def generar_js(registro):
    """Regenera planillas_extra.js a partir del registro completo."""
    miembros, fotos = [], {}
    for archivo, entrada in sorted(registro.items()):
        clave_semilla = "planillas/" + archivo
        miembro = {"seedKey": clave_semilla, "estado": "Activo"}
        for snake, campo in MAPA_CAMPOS.items():
            miembro[campo] = entrada.get("datos", {}).get(snake, "")
        miembros.append(miembro)
        if entrada.get("foto"):
            fotos[clave_semilla] = entrada["foto"]

    contenido = (
        "/* planillas_extra.js - Generado por escanear_planillas.py. NO editar a mano:\n"
        "   se regenera completo en cada ejecucion del script. */\n\n"
        "window.SEED_MEMBERS_EXTRA = " + json.dumps(miembros, ensure_ascii=False, indent=2) + ";\n\n"
        "window.SEED_PHOTOS_EXTRA = " + json.dumps(fotos, ensure_ascii=False) + ";\n"
    )
    io.open(SALIDA_JS, "w", encoding="utf-8").write(contenido)


def main():
    print("=" * 60)
    print("  Escáner de planillas — Membresía CFNJ")
    print("=" * 60)

    os.makedirs(CARPETA_PLANILLAS, exist_ok=True)

    clave = leer_clave_gemini()
    if not clave:
        print("\nNo se encontró la clave de Gemini en datos.js (PRECONFIG.geminiKey).")
        sys.exit(1)

    extensiones = (".jpg", ".jpeg", ".png", ".webp")
    archivos = sorted(
        f for f in os.listdir(CARPETA_PLANILLAS)
        if f.lower().endswith(extensiones)
    )
    registro = cargar_registro()
    pendientes = [f for f in archivos if f not in registro]

    if not archivos:
        print(f"\nLa carpeta está vacía. Copia las fotos de las planillas en:\n  {CARPETA_PLANILLAS}")
        sys.exit(0)
    if not pendientes:
        print(f"\nNo hay planillas nuevas ({len(archivos)} ya procesadas).")
        sys.exit(0)

    print(f"\n{len(pendientes)} planilla(s) nueva(s) por procesar.\n")

    correctas = 0
    for i, archivo in enumerate(pendientes, 1):
        print(f"[{i}/{len(pendientes)}] {archivo} ... ", end="", flush=True)
        try:
            b64, original = imagen_a_base64(os.path.join(CARPETA_PLANILLAS, archivo))
            datos = llamar_gemini(clave, b64)
            foto = recortar_foto(original, datos)
            nombre = datos.get("nombres", "").strip() or "(sin nombre)"
            registro[archivo] = {"datos": datos, "foto": foto}
            json.dump(registro, io.open(REGISTRO, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(f"OK -> {nombre}" + ("" if foto else "  (sin foto detectada)"))
            correctas += 1
        except Exception as e:
            print(f"ERROR: {e}")

    generar_js(registro)
    print("\n" + "=" * 60)
    print(f"  Listo: {correctas} planilla(s) procesadas correctamente.")
    print("  Abre index.html y los miembros nuevos se importarán solos.")
    print("=" * 60)


if __name__ == "__main__":
    main()
