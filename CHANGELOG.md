# Historial de cambios

Cambios del Sistema de Membresía de la Confraternidad Cristiana Nueva Jerusalén,
del más reciente al más antiguo. El registro de quién cambió qué dato (miembros y
equipos) vive dentro de la app, en la sección **Historial**.

## 2026-10-28

### Agregado
- **Exportar carnets para Canva** (Carnets): PDF con una página del tamaño real
  del carnet por persona, con texto editable al importarlo en Canva, o un ZIP con
  un PNG en alta resolución por carnet. Para los seleccionados o todos los activos.
- **Estado de los equipos**: la lista desde Equipos incluye también a quienes
  ya están al día (en verde), con el conteo "x de y al día" por equipo.
- **PDF de datos pendientes ordenado por equipo**: una banda por equipo con su
  número y su líder, resumen con totales arriba.
- Los nombres de los equipos se muestran tal como están en el documento de la
  cosecha; se corrigió la ortografía de 6 fichas según ese documento.
- **Mover elementos del carnet** (estilo Canva): en la vista previa se puede
  arrastrar cada elemento (logo, foto, nombre, cédula, rol, año, QR, dirección),
  cambiarle el tamaño o moverlo con las flechas del teclado. Se guarda por modelo
  y se respeta al imprimir y en el PNG.
- La foto del carnet Bandera ahora es vertical (19 × 24 mm).
- **Equipos: datos pendientes.** Filtro "Con datos pendientes", cada persona
  muestra lo que le falta y el botón "Lista de pendientes" exporta solo a la
  gente de los equipos.
- **Datos pendientes** (Miembros, menú Importar / exportar): tabla de quién debe
  entregar foto, cédula, teléfono u otros datos, y de las personas de los equipos
  de cosecha que aún no tienen ficha. Se exporta a Excel o PDF, o se copia
  agrupada por equipo para enviarla por WhatsApp.
- **Ajustar foto**: encuadrar, acercar, girar y recortar la foto de cada miembro
  (desde la ficha, al editar o haciendo clic en la foto del carnet).
- **Forma de la foto del carnet** para todos los modelos: como el modelo,
  rectangular, cuadrada o redonda.
- Carga de una tanda de 67 planillas: 19 miembros nuevos y la huella de cada
  planilla, para que no se dupliquen si se vuelven a subir.

### Corregido
- En el PNG del carnet las fotos podían salir estiradas si no tenían la misma
  proporción que su recuadro; ahora se recortan antes de exportar.

## 2026-10-27

### Agregado
- **Historial de cambios en la app.** Registra quién creó, editó o borró cada
  miembro y equipo, cuándo y qué campos cambiaron. Lo escriben triggers de la base
  de datos, así que queda registrado todo cambio sin importar desde dónde se haga.
  Permite restaurar un miembro borrado, y la ficha de cada miembro muestra sus
  últimos cambios.
- **Equipos de cosecha** (reemplazan a los oikos): cada equipo tiene un líder y sus
  colaboradores, vinculados a su ficha o solo con su nombre si aún no están
  registrados. Se cargaron los 26 equipos del documento de la cosecha (104 personas).
- **Carga masiva de planillas**: acepta PDF del escáner (una planilla por página),
  lee dos planillas a la vez, muestra el avance en vivo, se puede detener y
  reintenta sola cuando la IA está ocupada. Vincula a los miembros nuevos con su
  equipo cuando el nombre coincide sin ambigüedad.
- **Carnets Bandera, Bandera v2 y Bandera v3**, basados en el diseño de Canva.
- **Inicio rediseñado**: resumen de la membresía del año con el avance de carnets
  listos, cumpleaños del mes, datos por completar (con acceso directo al filtro) y
  distribución por funciones.
- Filtro "Le falta" (foto, cédula, teléfono o fecha de nacimiento) en Miembros.
- **Keep-alive**: cron diario de Vercel y workflow de GitHub cada 12 horas para que
  Supabase no pause el proyecto.

### Cambiado
- **Base de datos nueva en Supabase.** Se migraron desde el respaldo los miembros,
  las cuentas (con sus contraseñas) y el código de invitación. Las fotos pasaron a
  Supabase Storage.
- La función que se muestra en tabla, ficha y carnet es el rol del equipo (Líder o
  Colaborador). A quien no está en un equipo se le quitan las menciones a oikos. El
  texto original de la planilla no se modifica.
- Diseño general: tipografía Lexend y Source Sans 3; la franja tricolor marca la
  sección activa; tabla de miembros más compacta.
- Importar y exportar quedan agrupados en un solo menú en Miembros. Las fotos se
  descargan en un ZIP; el CSV incluye estado, rol y equipo; el respaldo JSON incluye
  los equipos.
- El service worker pide primero la versión nueva de los archivos de la app (antes
  un despliegue nuevo no llegaba hasta la segunda recarga).

### Corregido
- El inicio de sesión fallaba con "Sin internet" porque el navegador seguía usando
  la configuración del proyecto de Supabase anterior.
- Si la librería de Supabase no cargaba, la app abría en modo local vacío sin
  avisar; ahora muestra el error.
- Algunas descargas se cancelaban en Firefox y Safari.
- "Copiar lista" fallaba en navegadores sin permiso de portapapeles.
- Los nombres con tildes salían dañados dentro del ZIP de fotos.
- Los vínculos de los equipos cargados desde el documento se guardaron como texto
  y no se reconocían; se convirtieron a número y la app ahora los normaliza.

## 2026-09-14

- Seguridad: el código de invitación pasó al servidor (ya no está en la app).
- Detección de planillas duplicadas (misma imagen, misma persona y cédula única en
  la base).
- Respaldo y restauración sin duplicados, aviso de cambios rechazados al
  sincronizar y botón para mover las fotos a Supabase Storage.

## 2026-07-23

- Modelos de carnet Verde, Blanco y Tricolor, editor de elementos del carnet y
  formato de cédulas y teléfonos.
- Descarga de fotos de los miembros, planilla en blanco imprimible y exportar lista
  básica (texto, TXT, Word, PDF).
- Página de presentación, orden alfabético en la tabla y navegación entre fichas.
- Carga rápida de miembros (copia local primero y fotos en segundo plano).

## 2026-07-21

- Primera versión: app web, base de datos en Supabase con inicio de sesión y
  lectura de planillas manuscritas con IA.
- Registro de cuentas con código de invitación.
- Funciona sin internet (PWA) con cola de cambios y sincronización automática.
- Diseño adaptable a teléfono, tableta y computadora; filtros avanzados e impresión
  de carnets nueve por hoja.
