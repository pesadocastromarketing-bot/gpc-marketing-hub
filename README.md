# GPC Marketing Hub — publicidad y calendario multicuenta

Aplicación del Grupo Pesado Castro desarrollada sobre React/Vite, Supabase y Vercel.

## Funciones implementadas
- Autenticación Supabase y separación por workspace mediante RLS.
- Meta Marketing API: lectura de cuentas, campañas, resultados e Insights, conjuntos, anuncios, imágenes, carruseles y video cuando Meta expone el recurso.
- Campañas: filtro por activas, búsqueda, filtro por objetivo, selección hasta 25 y acciones masivas: pausar, activar y cambiar presupuesto diario a nivel campaña. Estas acciones REQUIEREN autorización independiente de `ads_management`, confirmación literal y registran una auditoría.
- Calendario: biblioteca de creatividades (Supabase Storage privado), hasta diez archivos por creatividad, repetición masiva para fechas × marcas × redes. Máximo 200 publicaciones por lote.
- Fecha/hora: Argentina (UTC−3). Borradores y planificación persistidos en Supabase.
- OAuth independiente para publicación social mediante páginas Facebook y opción de Instagram, más asociación de cada cuenta con su marca.
- Cola de trabajos de publicación con ejecución de Vercel Cron cada minuto, protegida por `CRON_SECRET`; procesa hasta cinco publicaciones por corrida, registra resultados y errores. Requiere que la aplicación tenga permisos Meta concedidos.
- Preparación y publicación de fotos, carruseles y Reels de Facebook y, solo donde Meta otorgue permisos específicos, fotos, carruseles y Reels de Instagram. Historias permanecen como borradores; no se envían.

## Requisitos de producción
Vercel en el proyecto existente:
- `VITE_SUPABASE_URL` (pública)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (pública)
- `VITE_META_APP_ID` (pública)
- `SUPABASE_SERVICE_ROLE_KEY` (privada)
- `META_APP_SECRET` (privada)
- `META_TOKEN_ENCRYPTION_KEY` (privada, AES-256-GCM)
- `CRON_SECRET` (privada, invocación Vercel Cron)

NUNCA exponer secrets con prefijo VITE_ ni dentro del repositorio.

### Meta
- Lectura: `ads_read`.
- Edición: `ads_management`; autorizar desde el HUB y requerir revisión Meta si corresponde.
- Publicación de páginas Facebook: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` y permiso para crear contenido en cada página.
- Instagram con Facebook Login: `instagram_basic` e `instagram_content_publish`; estas solicitudes pueden ser rechazadas hasta que el caso de uso correspondiente esté habilitado y aprobado. También puede corresponder Instagram API con Instagram Login, que utiliza otro flujo y permisos `instagram_business_*`. No suponer que agregar un caso de uso concede automáticamente permisos.
- En **Configuración → Redes para el calendario** autorizar y mapear cada página/perfil a una marca.
- Sin autorización: la opción de crear en lote guarda la planificación, pero no publica. “Crear y programar” solicita programación explícita y devuelve éxito/error por publicación.

### Controles de publicación
- Al programar, el servidor valida rol, pertenencia a marca y cuenta, fecha futura, formato y archivo.
- Contenido por estado: `draft`, `scheduled`, `publishing`, `published`, `failed`. La UI no puede simular estados `published`.
- El worker no reintenta automáticamente publicaciones fallidas; se evita la duplicación tras respuestas inciertas de Meta. Instagram Reel usa procesamiento diferido y seguimiento de contenedor.
- Las miniaturas e imágenes privadas utilizan URLs firmadas de duración limitada, generadas al publicar.
- El reloj del worker es aproximado (cron por minuto). Una cola muy grande puede extender la salida por varios minutos. El token Meta debe permanecer vigente al publicar.
- Actualmente la biblioteca admite JPG, PNG, WebP, MP4 y MOV hasta 50 MB. Meta es más restrictivo: Instagram imágenes JPG y Facebook imágenes JPG/PNG. El sistema valida antes de encolar.
- Meta no garantiza las mismas capacidades en todas las apps, páginas y cuentas. La primera publicación debe probarse en cuentas autorizadas.

### Límites actuales
- La pantalla del dashboard solo muestra campañas de la última cuenta consultada; los datos de Ads no se agregan automáticamente entre todas las cuentas.
- Los perfiles de Instagram requieren revisión/configuración de permisos; el producto de WhatsApp de la app existente no sustituye los permisos de Instagram.
- Historias y algunos anuncios con presupuesto de conjunto no se gestionan en la acción de presupuesto de campaña. Para estos, el HUB informa una limitación en lugar de actuar sobre otro objeto.
- No hay todavía revisión colaborativa por niveles ni una cola manual de reintentos de publicaciones fallidas.

## Desarrollo
```bash
npm install
npm run dev
```
Las migraciones ya fueron aplicadas al Supabase del proyecto `bnhltkzqwgjbaokusufj`; la carpeta `supabase/schema.sql` conserva el diseño inicial y no debe ejecutarse sobre una instancia con datos sin revisar primero.
