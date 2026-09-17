# Facturación

Sistema de facturación simple para EE. UU.: facturas con folio, sales tax, catálogo de productos, clientes, pagos con saldo automático, panel con estadísticas y ajustes. Todo se guarda en el navegador (`localStorage`) — sin cuentas, sin servidor.

## Ejecutar localmente

Es un sitio estático. Cualquiera de estas opciones funciona:

```bash
python3 -m http.server 8000
# o
npx serve .
```

Luego abre `http://localhost:8000`.

## Publicar

Al ser HTML/CSS/JS puro, se puede subir tal cual a cualquier hosting estático (GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.) — no requiere build ni backend.

## Estructura

- `index.html` — estructura de la app (barra lateral, vistas, modales)
- `css/styles.css` — estilos
- `js/app.js` — toda la lógica: datos, vistas, PDF, exportación
- `js/vendor/` — librerías de terceros incluidas localmente (jsPDF, jsPDF-AutoTable, SheetJS/xlsx) para no depender de un CDN externo

## Límites actuales

- Los datos viven solo en el navegador de cada dispositivo. Usa "Ajustes → Respaldo" para exportar/importar un respaldo en JSON.
- No hay sincronización en tiempo real entre varios usuarios/dispositivos todavía — eso requiere una base de datos en la nube y cuentas, que es un paso aparte.
