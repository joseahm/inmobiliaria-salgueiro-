# Deploy En Hetzner CX22

Guia para levantar el sistema en una VPS Hetzner CX22 con Docker Compose.

## Arquitectura

- `frontend`: React compilado y servido con Nginx.
- `backend`: FastAPI con Uvicorn.
- `db`: PostgreSQL 16.
- Volumen `postgres_data`: datos de PostgreSQL.
- Volumen `backend_uploads`: facturas y comprobantes subidos.

El frontend expone el puerto `80` y reenvia `/api/*` al backend interno.

## 1. Crear Servidor

Recomendado:

- Ubuntu 24.04 LTS.
- CX22: 2 vCPU, 4 GB RAM, 40 GB SSD.
- Agregar una SSH key si queres entrar por SSH. Si no, usar password temporal de Hetzner y luego endurecer.

## 2. Entrar Al Servidor

```bash
ssh root@TU_IP
```

## 3. Instalar Docker

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verificar:

```bash
docker --version
docker compose version
```

## 4. Firewall Basico

Si vas a entrar por SSH y servir HTTP:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw enable
ufw status
```

Cuando agregues HTTPS:

```bash
ufw allow 443/tcp
```

## 5. Descargar El Repo

```bash
mkdir -p /opt/apps
cd /opt/apps
git clone https://github.com/joseahm/inmobiliaria-salgueiro-.git
cd inmobiliaria-salgueiro-
```

Si el repo es privado, GitHub te va a pedir usuario y token.

## 6. Crear Variables De Produccion

```bash
cp .env.production.example .env.production
nano .env.production
```

Valores importantes:

```bash
APP_PORT=80
POSTGRES_PASSWORD=poner-un-password-largo
ALLOWED_ORIGINS="http://TU_IP_O_DOMINIO"
JWT_SECRET="poner-un-secreto-largo"
DEMO_ADMIN_EMAIL="admin@tu-dominio.com"
DEMO_ADMIN_PASSWORD="poner-password-admin"
SEED_DEMO_DATA_ON_STARTUP=false
```

Si todavia no tenes dominio, usa:

```bash
ALLOWED_ORIGINS="http://TU_IP"
```

Si despues usas dominio:

```bash
ALLOWED_ORIGINS="https://app.tu-dominio.com"
```

## 7. Levantar El Sistema

```bash
docker compose up -d --build
```

Ver estado:

```bash
docker compose ps
```

Ver logs:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db
```

Abrir:

```text
http://TU_IP
```

API:

```text
http://TU_IP/api/health
```

## 8. Actualizar Despues De Subir Cambios A GitHub

```bash
cd /opt/apps/inmobiliaria-salgueiro-
git pull
docker compose up -d --build
```

## 9. Crear Datos Demo Solo Si Hace Falta

Produccion debe quedar con:

```bash
SEED_DEMO_DATA_ON_STARTUP=false
```

Si queres cargar datos demo una vez:

```bash
docker compose exec backend python reset_demo_data.py
```

Para una base vacia, no ejecutes ese script.

## 10. Backup Basico

Crear carpeta:

```bash
mkdir -p /opt/backups/inmobiliaria
```

Backup de PostgreSQL:

```bash
docker compose exec -T db pg_dump -U inmobiliaria inmobiliaria > /opt/backups/inmobiliaria/db-$(date +%F).sql
```

Backup de uploads:

```bash
docker run --rm -v inmobiliaria-salgueiro-_backend_uploads:/data -v /opt/backups/inmobiliaria:/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

## 11. Restaurar Backup De PostgreSQL

```bash
cat /opt/backups/inmobiliaria/db-YYYY-MM-DD.sql | docker compose exec -T db psql -U inmobiliaria inmobiliaria
```

## 12. HTTPS

Para primera prueba, HTTP por IP alcanza.

Para compartirlo seriamente, conviene poner dominio y HTTPS. Opciones:

- Cloudflare proxy delante del servidor.
- Caddy como reverse proxy.
- Nginx Proxy Manager.
- Traefik.

La opcion mas simple suele ser Cloudflare + Nginx Proxy Manager o Caddy.

## 13. Notas Importantes

- No subir `.env.production`.
- No usar `admin123` en produccion.
- Cambiar `JWT_SECRET`.
- PostgreSQL y uploads viven en volumenes Docker; hacer backups.
- El servidor CX22 alcanza para esta primera version, pero si se suben muchos PDFs conviene vigilar disco.
