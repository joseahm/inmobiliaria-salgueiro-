# Inmobiliaria Salgueiro

Sistema operativo para administracion inmobiliaria: fincas, contratos, deudas, pagos, caja, gastos a propietario, servicios, comprobantes, auditoria, liquidaciones y exportes contables.

## Credenciales iniciales

- Email: `admin@salgueiro.test`
- Password: `admin123`

## Backend

```bash
cd backend
uv venv .venv --python python3
uv pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn app.main:app --reload --port 8000
```

API: `http://localhost:8000`  
Docs: `http://localhost:8000/docs`

### Credencial para correo de facturas

Para probar la captura automatica por Gmail/IMAP, guardar la app-password en `backend/.env`:

```bash
INVOICES_EMAIL_ADDRESS="facturas@tu-dominio.com"
INVOICES_EMAIL_HOST="imap.gmail.com"
INVOICES_EMAIL_USERNAME="facturas@tu-dominio.com"
INVOICES_EMAIL_SECRET_ENV_VAR="FACTURAS_EMAIL_PASSWORD"
INVOICES_EMAIL_FOLDER="INBOX"
FACTURAS_EMAIL_PASSWORD="pegar-aca-la-app-password-de-google"
```

En la app, en `Facturas`, el correo ya queda preparado con esos valores al reiniciar datos. El campo `Variable de clave` debe quedar como `FACTURAS_EMAIL_PASSWORD`. No pegar ahi la clave real.

Despues de cambiar `backend/.env`, reiniciar el backend.

### OCR de facturas y PDFs

La carga rapida por factura acepta imagenes y PDFs. Para PDFs con texto seleccionable usa PyMuPDF; para fotos o PDFs escaneados usa OCR local con Tesseract cuando esta instalado:

```bash
brew install tesseract tesseract-lang
```

Si Tesseract no esta disponible, el endpoint puede leer PDFs con texto seleccionable, pero no podra leer fotos o PDFs escaneados con buena precision.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

App: `http://localhost:5173`

## Verificacion

```bash
cd backend && .venv/bin/pytest -q
cd frontend && npm run build
```

## Docker / VPS

Para levantar todo con Docker Compose:

```bash
cp .env.production.example .env.production
docker compose up -d --build
```

La app queda disponible en `http://localhost` y el frontend reenvia `/api` al backend.

Guia completa para Hetzner CX22: [DEPLOYMENT.md](DEPLOYMENT.md).

## Datos Iniciales

Para reiniciar la base local con datos de prueba operativos:

```bash
cd backend
.venv/bin/python reset_demo_data.py
```

El dataset incluye propietarios con varias fincas, una finca 50/50, pagos de varios meses, saldo a favor, gastos repartidos, servicios por finca y liquidaciones detalladas.

## Notas de repositorio

Los archivos con contexto privado de discovery, audios, capturas, bases locales y comprobantes subidos no se incluyen en Git. El repositorio debe contener el codigo fuente, scripts y documentacion tecnica necesaria para levantar el sistema.
