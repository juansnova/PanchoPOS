# Auditoría de seguridad — PanchoPOS (2026-10-22)

**Alcance:** backend FastAPI (`back/app`), ws-bridge, frontend Angular, HAProxy/nginx, Docker Compose (base, dev, prod, tunnel), configuración y secretos, historial de git.
**Método:** revisión estática de código y configuración. Se inspeccionaron a fondo autenticación, sesiones, RBAC, aislamiento por tenant, endpoints públicos, subidas, webhooks, proxy y contenedores. `main.py` (14 mil líneas) se revisó por muestreo dirigido (grep de patrones de riesgo + lectura de los flujos críticos), no línea por línea.
**No incluido:** pruebas dinámicas/pentest, `pip-audit` / `npm audit` (requieren contenedor y acceso a red), revisión de integraciones DIAN/Factus y Revolut en detalle.
**Nota:** el informe no contiene valores de secretos.

## Resumen

| Severidad | Cantidad |
|---|---|
| Crítica | 1 |
| Alta | 4 |
| Media | 8 |
| Baja / informativa | 5 |

El diseño del código es sólido (RBAC central, filtro por tenant consistente, precios calculados en servidor, bcrypt, 2FA con códigos de recuperación hasheados). Los problemas graves están en **configuración y despliegue**, no en la lógica.

---

## Crítica

### C1. Los secretos JWT son los valores de ejemplo públicos
`config.env` tiene `SECRET_KEY` y `REFRESH_SECRET_KEY` con el texto placeholder `CHANGE_THIS_…` de `config.env.example`, que está en el repositorio. `docker-compose.yml` además cae por defecto a `CHANGE_THIS_IN_PRODUCTION`, y no hay validación al arrancar que lo impida (`settings.py` solo define el default).

**Impacto:** quien conozca el placeholder puede firmar un JWT válido (`sub`=usuario, `tenant_id`, `token_version`=0) y entrar como owner si adivina el nombre de usuario. También se derivan de `SECRET_KEY` la clave Fernet de credenciales de delivery (`delivery_credentials.py`) y el HMAC de los tokens de pedido público de delivery (`main.py` ~791), así que todos quedan comprometidos.

**Remediación:**
1. Generar dos secretos distintos de 64 bytes (`python -c "import secrets;print(secrets.token_urlsafe(64))"`).
2. Hacer que el backend **falle al arrancar** si el secreto es un placeholder o tiene menos de 32 caracteres.
3. Ojo: rotar `SECRET_KEY` invalida las sesiones y **deja ilegibles las credenciales de delivery cifradas** (hay que re-ingresarlas, o migrar a una clave de cifrado propia con re-cifrado).

---

## Alta

### A1. Cookies de sesión sin `Secure` y sin HSTS
`PRODUCTION` no está definido ni en `config.env` ni se pasa en `docker-compose.yml`; `secure=settings.is_production` queda en `False`. HAProxy prod no envía `Strict-Transport-Security`.
**Remediación:** definir `PRODUCTION=true` en producción (pasarlo en el compose prod) y añadir HSTS en `haproxy.prod.cfg`.

### A2. CORS `*` con `allow_credentials=True`
`CORS_ORIGINS=*` en `config.env`. Starlette refleja el `Origin` cuando hay cookies, así que cualquier sitio queda autorizado a leer respuestas autenticadas. Hoy lo mitiga `SameSite=Lax` (no envía cookies en fetch cross-site), pero es una configuración peligrosa que se rompe con un solo cambio (p. ej. pasar a `SameSite=None`). Lo mismo en `ws-bridge`.
**Remediación:** lista explícita de orígenes (`https://tu-dominio`); el frontend va por el mismo origen vía `/api`, así que ni siquiera hace falta CORS.

### A3. Servidor de desarrollo en producción
`docker-compose.yml` arranca `uvicorn … --reload` con el código montado (`./back:/app`) y el `Dockerfile` también; el overlay prod no lo sobreescribe. Además `/docs`, `/redoc` y `/openapi.json` son públicos vía `/api/docs`, y el contenedor corre como root salvo que el compose fije `user`.
**Remediación:** en `docker-compose.prod.yml` sobreescribir `command` sin `--reload` (y sin seeds de demo), no montar el código, deshabilitar docs en producción, usuario no root en el `Dockerfile`.

### A4. `docker-compose.tunnel.yml` publica el stack de desarrollo en internet
Expone HAProxy dev (puerto 4202, sin HTTPS forzado) con una URL pública de Cloudflare. Combinado con C1, A1 y A2, es el vector de explotación inmediato. El archivo está sin commitear (`??`).
**Remediación:** no usar el túnel hasta resolver C1; si se usa, añadir Cloudflare Access (login previo) delante y no dejarlo levantado de forma permanente.

---

## Media

| ID | Hallazgo | Detalle y remediación |
|---|---|---|
| M1 | **Contraseña de la BD `pos`** y Redis sin autenticación | `POSTGRES_PASSWORD=pos` (len 3). Postgres/Redis publican solo en `127.0.0.1`, lo que reduce el riesgo, pero Redis guarda la denylist de refresh tokens y los contadores de rate-limit. Poner contraseña fuerte a la BD y `requirepass` a Redis. |
| M2 | **Contraseña en query string en `/register`** | `password`, `username` son parámetros de URL; `option httplog` de HAProxy registra la línea de petición completa. Moverlos al cuerpo JSON. |
| M3 | **Sin política de contraseñas** | `UserCreate`/`UserUpdate`/`register` aceptan cualquier longitud. Exigir mínimo 10–12 caracteres. |
| M4 | **Rate limit solo por IP** en login y OTP | Sin bloqueo por cuenta; TOTP sin protección contra reutilización (`valid_window=1`, no se guarda el último código usado). Con Redis caído cae a memoria por proceso. Añadir contador por usuario y bloqueo temporal. |
| M5 | **`/ws-token` devuelve el access token HttpOnly al JS** y el WS lo recibe por query string | Anula la protección HttpOnly (XSS → robo de token) y el token queda en logs de HAProxy. Mejor: autenticar el WS con la cookie (mismo origen) o con un ticket de un solo uso de 30 s. |
| M6 | **Sesiones no revocables de verdad** | El refresh token no rota; `logout` solo agrega a la denylist (y falla abierto si Redis cae); el access token sigue válido hasta 30 min; `ws-bridge` no comprueba `token_version`. Rotar refresh tokens y bumpear `token_version` en logout. |
| M7 | **Secretos de tenant en texto plano en la BD** | `stripe_secret_key`, `revolut_merchant_secret`, `smtp_password` (`models.py`). Solo las credenciales de delivery están cifradas, y con clave derivada de `SECRET_KEY` (ver C1). Cifrarlos con una clave dedicada. |
| M8 | **Dependencias backend sin fijar** | `requirements.txt` usa `>=` y no hay lockfile/hashes (el frontend sí está fijado con `save-exact` e `ignore-scripts`). Fijar versiones con `pip-compile --generate-hashes` e instalar con `--require-hashes`. |

---

## Baja / informativa

- **L1. Cabeceras de seguridad incompletas:** solo `nosniff` y `Referrer-Policy`. Faltan `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` (clickjacking) y `Permissions-Policy` en HAProxy/nginx.
- **L2. Endpoints internos accesibles públicamente:** `GET /internal/validate-table/{token}` (pensado para ws-bridge) responde por `/api/internal/…`. Bloquear `/api/internal` en HAProxy.
- **L3. Webhook de delivery** (`/public/webhooks/delivery/{token}`): autenticado solo por token en la URL (queda en logs), comparación no constante en SQL y sin firma HMAC del proveedor. Añadir verificación de firma cuando los adaptadores dejen de ser stubs.
- **L4. Campos de texto libre sin `max_length`** (`notes`, `customer_name`, `delivery_address` en endpoints públicos): riesgo de abuso de almacenamiento. La subida de imágenes valida el tipo por el `Content-Type` del cliente; Pillow decodifica el raster (bien), pero no hay `Image.MAX_IMAGE_PIXELS` explícito contra bombas de descompresión. Los SVG se guardan tal cual, mitigado por `CSP: sandbox` + `nosniff` en `/uploads/*` (correcto).
- **L5. `ws-bridge`:** sin comprobación de `Origin` en el WebSocket y logging verboso de cabeceras.

---

## Controles que funcionan bien

- Aislamiento por tenant consistente: las consultas por id filtran `tenant_id` (revisados los `session.get` con id de cliente; todos validan propiedad).
- RBAC centralizado (`permissions.py`) y 206 rutas con `require_permission`; solo el owner gestiona usuarios; no puede degradarse a sí mismo.
- Los JWT distinguen `type` (access / refresh / otp_pending) con secretos separados para refresh; `ws-bridge` también valida el `type`.
- Contraseñas con bcrypt; cambio de contraseña incrementa `token_version`; códigos de recuperación 2FA guardados como hash y de un solo uso.
- Precios y totales los calcula el servidor (los modelos de pedido no aceptan precios).
- Código de mesa de 4 dígitos con bloqueo tras fallos y `hmac.compare_digest`.
- Tokens de mesa y reservas son UUID4 (122 bits); ruta explícita que deniega `/uploads/{tenant}/contracts/*`.
- HAProxy sobreescribe `X-Forwarded-For` (el rate limit no es falsificable); sin SQL por concatenación (el único `text()` usa parámetros; `migrate.py` solo interpola nombres de tabla internos).
- Frontend: sin `eval`, HTML de impresión escapado con `escapeHtml`, los `bypassSecurityTrust*` reciben constantes o URLs construidas por el cliente de API; dependencias npm fijadas y sin scripts de instalación.
- `config.env` está en `.gitignore` y **no aparece en el historial de git** (324 commits revisados: sin secretos reales commiteados).

---

## Plan de remediación sugerido

1. **Hoy:** C1 (rotar secretos + guardia de arranque), A4 (apagar el túnel hasta entonces), `PRODUCTION=true`, contraseña de BD, CORS explícito.
2. **Esta semana:** A3 (compose prod sin `--reload`/docs), M2/M3 (contraseña al cuerpo + política), HSTS/CSP, bloquear `/api/internal`.
3. **Siguiente:** M4–M7 (rate limit por cuenta, WS por ticket, rotación de refresh, cifrado de secretos de tenant), M8 (pin de dependencias) y correr `pip-audit` / `npm audit` dentro de contenedores.
