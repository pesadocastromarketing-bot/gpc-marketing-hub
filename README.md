# GPC Marketing Hub — MVP visual v0.1

Prototipo navegable e independiente de PIT CRM. Incluye dashboard, selector de marcas, gestor visual de campañas con DATOS FICTICIOS, calendario mensual, borradores de publicaciones, duplicación en lote, y módulos reservados para creatividades, públicos, reportes, ideas y configuración.

## Ejecutar

```bash
npm install
npm run dev
```

Abrir la URL indicada por Vite (habitualmente http://localhost:5173). Los borradores se conservan en `localStorage` de ese navegador.

## Limitaciones importantes

- No existe aún conexión OAuth con Meta ni importación de Insights reales.
- No se publican posts ni se modifican campañas reales.
- Los datos de la sección Publicidad son ejemplos claramente rotulados.
- SQL en `supabase/schema.sql` es un borrador de esquema seguro orientado a varias organizaciones; NO está aplicado a ningún proyecto.
- El SQL no implementa todavía permisos de escritura sobre jobs, ni el backend publicador, ni los tokens de Meta. Requiere revisión e integración antes de desplegar producción.

## Próximos hitos

1. Elegir un proyecto Supabase nuevo aislado y activar Supabase Auth para miembros.
2. Implementar OAuth de Meta con conexión por Business, cuentas publicitarias, páginas e Instagram, almacenamiento seguro de credenciales del lado servidor y scopes otorgados.
3. Lectura de Marketing Insights con paginación, limitación de tasa, refresco y fechas.
4. Biblioteca de archivos multimedia y cola de publicación idempotente por canal, con historial, reintentos y revisión/confirmación.
5. Replicación real entre cuentas con mapeo explícito de activos, capacidades y permisos.
