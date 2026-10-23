# PanchoPOS — Manual completo del sistema de Pancho Panza

> **Documento privado del propietario.** Este archivo contiene contraseñas y claves reales (administrador, Factus/DIAN, token de impresión). Úsalo solo en tu equipo. **No lo publiques, no lo subas a GitHub/Drive públicos y no lo envíes por chat o correo sin cifrar.** Si algún día se crea un repositorio remoto (GitHub, etc.), primero hay que sacar la sección [10. Credenciales](#10-credenciales-y-datos-sensibles) de este archivo.

PanchoPOS es el sistema de punto de venta (POS) de **Pancho Panza, Asadero y Restaurante** (San Vicente de Chucurí, Santander). Sirve para tomar pedidos, mandarlos a cocina y barra, imprimir comandas y facturas, recibir pedidos de clientes por QR, manejar reservas y domicilios, facturar electrónicamente ante la DIAN y ver reportes de ventas.

Este documento está escrito para una persona **no técnica**: explica qué es cada pieza, qué hay que configurar, dónde se configura y cómo hacerlo paso a paso. Las partes técnicas están claramente marcadas.

---

## Índice

1. [Cómo funciona todo, explicado simple](#1-cómo-funciona-todo-explicado-simple)
2. [Qué incluye el sistema](#2-qué-incluye-el-sistema)
3. [Qué necesitas antes de empezar](#3-qué-necesitas-antes-de-empezar)
4. [Instalación paso a paso (primera vez)](#4-instalación-paso-a-paso-primera-vez)
5. [Uso diario: encender, apagar y revisar](#5-uso-diario-encender-apagar-y-revisar)
6. [Configuración desde la aplicación (lo que hace el dueño)](#6-configuración-desde-la-aplicación-lo-que-hace-el-dueño)
7. [Archivo de configuración `config.env` (explicado línea por línea)](#7-archivo-de-configuración-configenv-explicado-línea-por-línea)
8. [Impresora térmica (comandas y facturas)](#8-impresora-térmica-comandas-y-facturas)
9. [Factura electrónica DIAN (Factus)](#9-factura-electrónica-dian-factus)
10. [Credenciales y datos sensibles](#10-credenciales-y-datos-sensibles)
11. [Correo y WhatsApp (opcional)](#11-correo-y-whatsapp-opcional)
12. [Usar el sistema desde internet (túnel o servidor)](#12-usar-el-sistema-desde-internet-túnel-o-servidor)
13. [Copias de seguridad y recuperación](#13-copias-de-seguridad-y-recuperación)
14. [Seguridad: lo que debes hacer antes de abrirlo a internet](#14-seguridad-lo-que-debes-hacer-antes-de-abrirlo-a-internet)
15. [Solución de problemas](#15-solución-de-problemas)
16. [Glosario](#16-glosario)
17. [Referencia técnica](#17-referencia-técnica)

---

## 1. Cómo funciona todo, explicado simple

Piensa en el sistema como un restaurante pequeño dentro del computador. Cada "empleado" es un **contenedor** (una cajita aislada que Docker enciende y apaga):

| Pieza | Qué hace en palabras simples | Nombre técnico |
|-------|------------------------------|----------------|
| **La puerta de entrada** | Recibe a todos los que llegan y los manda al lugar correcto. Es lo único que se abre al exterior. | `haproxy` |
| **La pantalla** | Lo que ves en el navegador: botones, mesas, menú. | `front` (Angular) |
| **El cerebro** | Recibe los pedidos, calcula precios, valida usuarios, emite facturas. | `back` (Python / FastAPI) |
| **El archivo** | Donde se guarda todo: pedidos, productos, usuarios, ventas. | `db` (PostgreSQL) |
| **El mensajero en vivo** | Avisa a cocina y meseros al instante cuando llega un pedido, sin recargar. | `ws-bridge` + `redis` |
| **El agente de impresión** | Programa pequeño en el PC de la impresora; recoge los tickets y los imprime. | `scripts/print-agent` |

```
Celular / tablet / PC  →  Puerta de entrada (HAProxy, puerto 4202)
                              ├─ pantalla (Angular)
                              ├─ cerebro (FastAPI)  ←→  base de datos (PostgreSQL)
                              └─ avisos en vivo (WebSocket + Redis)

PC de la impresora: agente de impresión ──pregunta cada segundo──► cerebro ──► impresora USB/red
```

**Idea clave:** todo vive en **un computador** ("el servidor") donde está instalado Docker. Los meseros entran desde sus celulares/tablets abriendo una dirección web, siempre que estén en la misma red WiFi (o si se configura acceso por internet, ver [sección 12](#12-usar-el-sistema-desde-internet-túnel-o-servidor)).

**Los datos** (pedidos, productos, usuarios) se guardan en un "disco virtual" de Docker llamado `pos_pgdata`. Las **imágenes subidas** (fotos de platos, logo) se guardan en la carpeta `back/uploads/` del proyecto. Para no perder nada, lee la [sección 13](#13-copias-de-seguridad-y-recuperación).

---

## 2. Qué incluye el sistema

| Área | Qué hace | Dirección (con la app en el puerto 4202) |
|------|----------|-------------------------------------------|
| **Panel del personal** | Inicio del dueño/meseros | `/dashboard` |
| **Pedidos** | Ciclo: pendiente → preparando → listo → entregado → pagado | `/orders` |
| **Mesas** | Crear mesas, código QR por mesa, plano | `/tables` |
| **Menú para clientes (QR)** | El cliente escanea el QR de su mesa, ve el menú y pide sin instalar nada. PIN de mesa opcional para evitar pedidos desde otra mesa | (se abre desde el QR) |
| **Cocina** | Pantalla con órdenes en tiempo real y sonido opcional | `/kitchen` |
| **Bar** | Igual que cocina, solo bebidas | `/bar` |
| **Reservas** | Los clientes reservan solos y pueden ver/cancelar con un enlace; el personal gestiona todo, con lista de espera y recordatorios | `/reservations`, público: `/book/{tenantId}` |
| **Lista de espera** | Pública para clientes | `/waitlist/{tenantId}` |
| **Domicilios** | Canal propio de domicilios (no Rappi/Uber) | público: `/delivery/{tenantId}` |
| **Portal del repartidor** | El repartidor ve y gestiona sus entregas | `/courier/login`, `/courier` |
| **Impresión** | Cola de tickets, errores, reintentos | `/printing` |
| **Reportes** | Ventas por producto, categoría, mesa, mesero; exportar a CSV/Excel | `/reports` |
| **Inventario** | Insumos, proveedores, órdenes de compra, stock | dentro del panel |
| **Usuarios** | Crear meseros, cocina, repartidores | `/users` |
| **Configuración** | Datos del negocio, horarios, impuestos, impresión, DIAN, correo | `/settings` |
| **Pagos** | Efectivo y datáfono (tarjeta física). *Stripe y Revolut fueron eliminados del sistema.* | dentro del pedido |
| **Factura electrónica DIAN** | Facturas y notas crédito vía Factus | Configuración → Facturación electrónica |
| **Documentación técnica de la API** | Solo para programadores | `/api/docs` |
| **Estado del sistema** | Responde `ok` si el cerebro está vivo | `/api/health` |

**Roles de usuario:**

| Rol | Puede |
|-----|-------|
| **Owner (dueño)** | Todo: configuración, usuarios, reportes, DIAN, impresión |
| **Waiter (mesero)** | Tomar pedidos, cobrar, usar la pantalla de bar |
| **Kitchen (cocina)** | Ver y cambiar el estado de las órdenes |
| **Courier (repartidor)** | Solo el portal de domicilios |

El cliente final **nunca necesita cuenta**.

---

## 3. Qué necesitas antes de empezar

### En el computador que será "el servidor"

Es el PC del local (o el que tengas) que debe estar **encendido mientras el restaurante trabaje**.

1. **Windows 10/11** (el que usas hoy) con al menos **8 GB de RAM** y 15 GB libres en disco.
2. **Docker Desktop** — el programa que enciende las "cajitas".
   - Descarga: https://www.docker.com/products/docker-desktop/ → instalar → reiniciar el PC si lo pide.
   - Al abrirlo por primera vez acepta los términos. Cuando abajo a la izquierda veas **"Engine running"** (verde), está listo.
   - Si Windows pide activar **WSL 2** o **virtualización**, acepta; si dice que la virtualización está desactivada en BIOS, hay que activarla (búscalo por el modelo del PC: "enable virtualization").
   - Para que Docker arranque con Windows: Docker Desktop → Settings → General → *Start Docker Desktop when you sign in*.
3. **Git for Windows** (https://git-scm.com/download/win): trae **Git Bash**, la terminal con la que se ejecutan los comandos de este documento y `run.sh`.
4. **Python 3** (solo para el agente de impresión). Ya está instalado en este PC: `C:\Users\juans\AppData\Local\Programs\Python\Python312\python.exe`.

> **Nota:** en la revisión de este documento, el comando `docker` **no se encontró** en el PC actual. Si es así en el equipo que vas a usar, instala Docker Desktop (punto 2) antes de seguir.

### Cómo abrir la terminal (donde se escriben los comandos)

- Abre la carpeta del proyecto (`C:\Users\juans\Downloads\PanchoPOS`) en el Explorador, haz clic derecho en un espacio vacío → **"Open Git Bash here"** (o *Abrir Git Bash aquí*).
- Todos los comandos de este manual se escriben ahí y se ejecutan con **Enter**.
- Un bloque como este se copia tal cual:

```bash
echo "esto es un comando"
```

---

## 4. Instalación paso a paso (primera vez)

> Si el sistema ya funciona en tu PC (existe `config.env` y la base de datos), salta a la [sección 5](#5-uso-diario-encender-apagar-y-revisar).

### Paso 1 — Abrir la terminal en la carpeta del proyecto

Carpeta: `C:\Users\juans\Downloads\PanchoPOS` (clic derecho → Git Bash here).

### Paso 2 — Crear el archivo de configuración

```bash
cp config.env.example config.env
```

Esto crea `config.env` (el panel de control del sistema, explicado en la [sección 7](#7-archivo-de-configuración-configenv-explicado-línea-por-línea)). **Este archivo nunca se sube a git** (está en `.gitignore`).

### Paso 3 — Poner secretos propios (obligatorio)

Hay que reemplazar dos valores de `config.env` por claves largas y aleatorias. Genéralas con:

```bash
python -c "import secrets;print(secrets.token_urlsafe(64))"
python -c "import secrets;print(secrets.token_urlsafe(64))"
```

Cada ejecución imprime una clave distinta. Abre `config.env` con el Bloc de notas y pega:
- una en `SECRET_KEY=`
- la otra en `REFRESH_SECRET_KEY=`

(deben ser **distintas entre sí**, sin espacios ni comillas).

Agrega también al final del archivo el usuario administrador inicial:

```
DEFAULT_ADMIN_USERNAME=el_usuario_que_quieras
DEFAULT_ADMIN_PASSWORD=una_contraseña_larga_y_segura
```

> **Importante:** si cambias `SECRET_KEY` más adelante, todas las sesiones abiertas se cierran y las credenciales de plataformas de delivery guardadas (cifradas con esa clave) quedan ilegibles y hay que volver a ingresarlas. Define la clave **una vez** al inicio y guárdala (sección 10).

### Paso 4 — Encender el sistema

Con Docker Desktop abierto y en verde, en Git Bash:

```bash
./run.sh -dev
```

Qué hace: construye y enciende los 6 contenedores, espera a que el cerebro esté listo y aplica las migraciones de la base de datos (crear/actualizar tablas). **La primera vez tarda 5–15 minutos** (descarga e instala todo). Al final muestra los registros en vivo; **déjala abierta** o ciérrala con `Ctrl + C` (ojo: `Ctrl + C` en este modo **apaga el sistema**; ver sección 5 para encenderlo "en segundo plano").

Al arrancar, el sistema automáticamente:
- aplica las migraciones (`python -m app.migrate`);
- crea el **usuario administrador** y el negocio "Pancho Panza" si no existen;
- carga un **menú de demostración** (`seed_demo_products`) si no hay productos.

### Paso 5 — Abrir la aplicación

Navegador (Chrome recomendado): **http://localhost:4202**

Inicia sesión con el usuario y la contraseña del administrador (`DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD`).

### Paso 6 — Comprobar que todo está sano

| Qué probar | Dirección | Resultado esperado |
|-----------|-----------|--------------------|
| Estado del cerebro | http://localhost:4202/api/health | Un mensaje de estado "ok" |
| Estado de la base de datos | http://localhost:4202/api/health/db | "ok" |
| Panel | http://localhost:4202/dashboard | Se ve el panel |
| Cocina | http://localhost:4202/kitchen | Pantalla de cocina |

Para ver el estado de los contenedores:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Los 6 (`pos-back`, `pos-front`, `pos-postgres`, `pos-redis`, `pos-ws-bridge`, `pos-haproxy`) deben decir `running` o `healthy`.

### Paso 7 — Configurar el negocio

Sigue la [sección 6](#6-configuración-desde-la-aplicación-lo-que-hace-el-dueño).

### Paso 8 — Configurar la impresora

Sigue la [sección 8](#8-impresora-térmica-comandas-y-facturas).

---

## 5. Uso diario: encender, apagar y revisar

Todos los comandos se escriben en Git Bash dentro de la carpeta del proyecto.

> Para no repetir el texto largo, en este manual `DC` significa:
> `docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml`

### Encender (en segundo plano, recomendado)

```bash
docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml up -d
```

El sistema queda funcionando aunque cierres la terminal. Espera ~30–60 segundos y abre http://localhost:4202.

### Apagar (sin perder datos)

```bash
docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml down
```

### Reiniciar solo el cerebro (después de cambiar `config.env`)

```bash
docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate back ws-bridge
```

> Cambiar `config.env` **no** se aplica solo: hay que reiniciar los contenedores como arriba. Si cambiaste `API_URL`, `WS_URL` o `GOOGLE_ANALYTICS_*`, reinicia también `front`.

### Ver el estado y los registros (logs)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=80 back
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=80 front
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=30 haproxy
```

### Aplicar migraciones a mano (rara vez necesario)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec back python -m app.migrate
```

### Que el sistema se encienda solo con el PC

1. Docker Desktop → Settings → General → activar *Start Docker Desktop when you sign in*.
2. Los contenedores ya tienen `restart: unless-stopped`: cuando Docker arranca, vuelven a encenderse solos (siempre que antes los hayas encendido con `up -d` y no los hayas apagado con `down`).
3. Activa el inicio de sesión automático de Windows si el PC se reinicia solo (Windows: `netplwiz`).

### Entrar desde celulares y tablets (misma red WiFi)

1. En el PC servidor, abre PowerShell y escribe `ipconfig`. Busca **"Dirección IPv4"** del WiFi, por ejemplo `192.168.1.25`.
2. En el celular (conectado al mismo WiFi) abre `http://192.168.1.25:4202`.
3. Si no abre: Windows Defender Firewall puede estar bloqueando. Permite el puerto **4202** (Panel de control → Firewall de Windows Defender → Configuración avanzada → Reglas de entrada → Nueva regla → Puerto → TCP 4202 → Permitir).
4. Recomendación: en tu router, **reserva una IP fija** para el PC servidor, para que la dirección no cambie.
5. Los **códigos QR de las mesas** deben generarse con una dirección que los clientes puedan abrir: mientras uses la IP local, solo funcionarán conectados al WiFi del local. Para QR que funcionen desde cualquier parte hay que usar internet (sección 12).

### Dos formas de arrancar (aclaración)

| Forma | Comando | Cuándo |
|-------|---------|--------|
| **Desarrollo** (la que usas) | `./run.sh -dev` o el `docker compose ... up -d` de arriba | Uso normal local, puerto **4202** |
| **Producción** | `./run.sh` | Servidor con dominio y HTTPS en puertos 80/443 (sección 12) |

---

## 6. Configuración desde la aplicación (lo que hace el dueño)

Entra como dueño y ve a **Configuración** (`/settings`). Orden recomendado para dejar el restaurante listo:

| # | Qué configurar | Dónde | Detalle |
|---|----------------|-------|---------|
| 1 | **Datos del negocio** | Configuración → Negocio / Perfil | Nombre, dirección, ciudad, teléfono, correo de contacto, moneda, logo y **imagen de marca** (encabezado de la página pública; hay vista previa) |
| 2 | **Horarios** | Configuración → Horarios | Horario de apertura por día (por defecto todos los días 10:30–21:15). Hay botones de "copiar de un día a otros" |
| 3 | **Impuestos** | Configuración → Impuestos | IVA / impuesto al consumo según indique tu contador |
| 4 | **Categorías y productos** | Productos / Catálogo | Crear el menú real (puedes importar desde JSON o desde una foto del menú si se configura la clave de visión, sección 7). Para que una bebida salga en la **impresora de barra**, ponla en la categoría `Bebidas` o asígnale estación *barra* |
| 5 | **Mesas** | Mesas | Crear mesas, descargar/imprimir el **QR** de cada una; activar **PIN de mesa** si no quieres pedidos desde fuera del local |
| 6 | **Usuarios** | Usuarios | Crear una cuenta por cada mesero, cocinero y repartidor, con su rol. **Nunca compartas la cuenta de dueño** |
| 7 | **Impresión** | Administración → Impresión | Crear el agente de impresión (sección 8) |
| 8 | **Correo (SMTP)** | Configuración → Email | Para confirmar reservas por correo (sección 11) |
| 9 | **Facturación electrónica** | Configuración → Facturación electrónica | DIAN (sección 9) |
| 10 | **Reservas / domicilios** | Reservas, Delivery | Cupos, duración de turno, zonas y costos de domicilio |
| 11 | **Seguridad de la cuenta** | Tu perfil | Activar **verificación en dos pasos (2FA)** y guardar los códigos de recuperación |

**El `tenantId`:** es el número que identifica a tu restaurante en el sistema. Lo necesitas en las direcciones públicas (`/book/{tenantId}`, `/delivery/{tenantId}`, `/waitlist/{tenantId}`). Lo ves en Configuración. El negocio de este sistema se crea automáticamente la primera vez.

---

## 7. Archivo de configuración `config.env` (explicado línea por línea)

`config.env` está en la raíz del proyecto. Es un archivo de texto con líneas `NOMBRE=valor`. Las líneas que empiezan con `#` son comentarios (se ignoran). Para activar una opción comentada, quita el `#` del inicio.

**Reglas de oro:**
- Sin espacios alrededor del `=`.
- Sin comillas (a menos que el valor las necesite).
- Tras cualquier cambio, **reinicia** los contenedores (sección 5).
- **Nunca** lo envíes ni lo subas a internet: es el archivo más sensible del proyecto.

### 7.1 Base de datos

| Variable | Qué es | Valor actual / recomendado |
|----------|--------|----------------------------|
| `POSTGRES_DB` | Nombre de la base de datos | `pos` |
| `POSTGRES_USER` | Usuario de la base de datos (no es `postgres`) | `pos` |
| `POSTGRES_PASSWORD` | Contraseña de la base | `pos` (suficiente si la base **no** se expone a internet; ver nota) |
| `POSTGRES_PORT` | Puerto para conectarse **desde el mismo PC** con una herramienta externa | `5433` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Cómo el cerebro llega a la base **dentro de Docker** | `db` / `5432` / `pos` / `pos` / `pos` — **no cambiar** `DB_HOST` ni `DB_PORT` |

> La base solo escucha en `127.0.0.1` (el propio PC), no en la red. Aun así, si cambias `POSTGRES_PASSWORD` en una base **ya creada**, el cambio no aplica a la base existente (la contraseña se fija la primera vez). Cámbiala **antes** del primer arranque o con `ALTER USER`. `DB_PASSWORD` y `POSTGRES_PASSWORD` deben ser iguales.

### 7.2 Seguridad de sesiones

| Variable | Qué es | Valor |
|----------|--------|-------|
| `SECRET_KEY` | Clave con la que se firman los inicios de sesión. También cifra credenciales de plataformas de delivery | Texto aleatorio de 64+ caracteres (ya definido en tu `config.env`) |
| `REFRESH_SECRET_KEY` | Segunda clave, **distinta**, para renovar sesiones | Idem |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Cuánto dura una sesión sin renovar | `30` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Cuántos días se mantiene la sesión abierta | `7` |
| `PRODUCTION` | `true` activa cookies seguras y rechaza claves débiles. **Ponlo en `true` solo cuando uses HTTPS** (sección 12/14); con `http://` no podrás iniciar sesión | no definido (= falso) |

### 7.3 Direcciones (cómo se conecta la pantalla con el cerebro)

| Variable | Qué es | Valor |
|----------|--------|-------|
| `API_URL` | Dirección del cerebro vista desde el navegador | `/api` (relativa; funciona desde cualquier IP o dominio — **no cambiar**) |
| `WS_URL` | Dirección de los avisos en vivo | vacío (automática) |
| `CORS_ORIGINS` | Sitios web autorizados a hablar con el cerebro | `*` (cualquiera) en local. En internet usa tu dominio: `https://tu-dominio.com` |
| `FRONTEND_PORT` | Puerto del PC donde se abre la app (modo desarrollo) | `4202` por defecto |
| `PUBLIC_APP_BASE_URL` | Dirección pública del sistema, para los enlaces en correos (ver/cancelar reserva, recuperar contraseña) | Sin definir. Ejemplo: `https://pos.tudominio.com`. **Sin esto, "Olvidé mi contraseña" no funciona** |
| `ROOT_PATH` | Interno (`/api`) | Lo fija Docker, no tocar |

### 7.4 Administrador inicial

| Variable | Qué es |
|----------|--------|
| `DEFAULT_ADMIN_USERNAME` | Usuario del dueño que se crea al primer arranque |
| `DEFAULT_ADMIN_PASSWORD` | Su contraseña |

Solo crea el usuario si **no existe**; cambiar estas líneas después **no** cambia la contraseña de un usuario ya creado. Para cambiarla usa tu perfil en la app, o el comando de la [sección 15](#15-solución-de-problemas) ("olvidé la contraseña").

### 7.5 Facturación electrónica DIAN (Factus)

Ver [sección 9](#9-factura-electrónica-dian-factus) para el significado y el proceso completo.

| Variable | Qué es |
|----------|--------|
| `DIAN_PROVIDER` | `factus` (real) o `mock` (simulación sin enviar nada a la DIAN) |
| `DIAN_PROVIDER_CLIENT_ID`, `_CLIENT_SECRET`, `_USERNAME`, `_PASSWORD` | Credenciales **reales (producción)** de Factus |
| `DIAN_SANDBOX_CLIENT_ID`, `_CLIENT_SECRET`, `_USERNAME`, `_PASSWORD` | Credenciales de **pruebas** de Factus (facturas sin validez legal) |
| `DIAN_LIVE_UNLOCK` | `true` permite elegir el modo "real" en Configuración; `false` lo bloquea |
| `DIAN_PROVIDER_BASE_URL` | Opcional: otra dirección de Factus |
| `DIAN_PACKAGE_DOCUMENTS` | Documentos que incluye tu paquete de Factus (por defecto 400) |
| `DIAN_PACKAGE_SINCE` | Fecha en que empezó el paquete actual (`AAAA-MM-DD`) |
| `DIAN_PACKAGE_ALERT_BELOW` | Avisa por correo cuando queden menos de este número de documentos (por defecto 40) |

### 7.6 Correo electrónico (SMTP) — opcional

| Variable | Qué es | Ejemplo Gmail |
|----------|--------|---------------|
| `SMTP_HOST` | Servidor de correo | `smtp.gmail.com` |
| `SMTP_PORT` | Puerto | `587` |
| `SMTP_USE_TLS` | Cifrado | `true` |
| `SMTP_USER` | Cuenta que envía | `tu-restaurante@gmail.com` |
| `SMTP_PASSWORD` | **Contraseña de aplicación** (no la normal) | 16 caracteres |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Remitente visible | `tu-restaurante@gmail.com` / `Pancho Panza` |

Paso a paso en la [sección 11](#11-correo-y-whatsapp-opcional).

### 7.7 WhatsApp (Twilio) — opcional

| Variable | Qué es |
|----------|--------|
| `TWILIO_ACCOUNT_SID` | Identificador de la cuenta Twilio |
| `TWILIO_AUTH_TOKEN` | Llave secreta de Twilio |
| `TWILIO_WHATSAPP_FROM` | Número remitente (formato `+14155238886`) |
| `DEFAULT_PHONE_COUNTRY` | País por defecto para números sin prefijo. **Para Colombia usa `CO`** (el ejemplo trae `ES`) |

### 7.8 Otras opciones

| Variable | Qué hace |
|----------|----------|
| `GOOGLE_ANALYTICS_MEASUREMENT_ID` | ID de Google Analytics `G-XXXXXXXXXX`. Mejor en un archivo `.secrets` (ignorado por git) en vez de `config.env`. Vacío = sin seguimiento |
| `PRODUCT_VISION_API_KEY` / `_URL` / `_MODEL` | Activa "importar el menú desde una foto" usando un servicio de IA de visión (OpenAI por defecto). Sin la clave, esa pestaña queda desactivada |
| `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `META_OAUTH_REDIRECT_URI` | Publicar en Facebook/Instagram desde Configuración. Requiere app en developers.facebook.com |
| `PUBLIC_TERMS_OF_SERVICE_URL` / `PUBLIC_PRIVACY_POLICY_URL` | Enlaces a términos y privacidad |
| `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES` | Vigencia del enlace de recuperar contraseña (60) |
| `RATE_LIMIT_*` | Límites contra abusos (intentos de login por 15 min, etc.). Los valores por defecto sirven |
| `RATE_LIMIT_ENABLED` | `true` por defecto; no desactivar |
| `COURIER_EMAIL` / `COURIER_PASSWORD` | Solo para pruebas del portal de repartidor con datos demo |

### 7.9 Otros archivos de configuración

| Archivo | Para qué | ¿Sensible? |
|---------|----------|-----------|
| `config.env` | Todo lo anterior | **Sí** (no se sube a git) |
| `.env` (opcional) | Usuario/clave para las pruebas automáticas | Sí (no se sube a git). Plantilla: `.env.example` |
| `.secrets` (opcional) | ID de Google Analytics | Sí (no se sube a git) |
| `scripts/print-agent/agent.env` | Configuración del agente de impresión (token + impresoras) | **Sí** (no se sube a git) |
| `docker-compose*.yml` | Cómo se arman los contenedores | No |
| `haproxy/haproxy.cfg` | Rutas de la puerta de entrada | No |

---

## 8. Impresora térmica (comandas y facturas)

### Cómo funciona

La app **no habla directo con la impresora**. Un programita, el **agente de impresión** (`scripts/print-agent/`), corre en el PC que tiene la impresora conectada, pregunta cada segundo a la app "¿hay tickets nuevos?" y los imprime en formato térmico de 80 mm (ESC/POS).

- **Comanda:** sale sola cuando un plato pasa a *preparando* (automático al minuto, o antes si el personal lo cambia). Cada plato sale una vez; si el cliente pide más, sale otra comanda `ADICION` solo con lo nuevo. Se separan por estación: **cocina** y **barra** (bebidas).
- **Factura:** sale al pulsar *Imprimir factura* en el pedido (negocio, cliente, detalle, propina, IVA, total).
- Si el agente no está conectado, el botón cae al cuadro de impresión normal del navegador.

### Estado actual en este PC

Impresora instalada en Windows con el nombre **`DigitalPOS`**; el agente ya tiene su token en `scripts/print-agent/agent.env` y está configurado con `KITCHEN_PRINTER=win:DigitalPOS` (cocina, barra y facturas salen por esa misma impresora).

### Puesta en marcha desde cero (Windows, impresora USB)

**1. Conectar e instalar la impresora en Windows**
Conecta el cable USB y enciéndela. Si Windows no la reconoce, instala el driver del fabricante, o añádela manualmente: *Configuración → Bluetooth y dispositivos → Impresoras → Agregar → "La impresora que quiero no aparece" → Agregar con configuración manual → puerto USB → Fabricante "Generic" → "Generic / Text Only"*. Ponle un nombre sin espacios raros (ej. `DigitalPOS`).

**2. Anotar el nombre exacto que usa Windows**
En PowerShell, desde la carpeta del proyecto:

```powershell
python scripts/print-agent/print_agent.py --list-printers
```

Copia el nombre tal cual aparece (respeta mayúsculas).

**3. Crear el agente en la app**
Entra como dueño → **Administración → Impresión** (o Configuración → Impresión) → **Crear agente**. Se muestra un **token** (una clave larga). **Se muestra una sola vez: cópialo ya.** Si lo pierdes, borra el agente y crea otro.

**4. Crear `agent.env`**

```bash
cp scripts/print-agent/agent.env.example scripts/print-agent/agent.env
```

Ábrelo con el Bloc de notas y completa:

```
PRINT_AGENT_API_BASE=http://127.0.0.1:4202/api
PRINT_AGENT_TOKEN=el_token_que_copiaste
KITCHEN_PRINTER=win:DigitalPOS
PRINT_AGENT_POLL_SEC=1
```

**5. Que arranque solo cada vez que inicies sesión en Windows**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\print-agent\install-autostart.ps1
```

Crea la tarea programada "PanchoPOS Print Agent" (se ejecuta oculta, se reinicia sola si falla). Para quitarla: el mismo comando con `-Remove`. Para probar a mano sin instalarla: `powershell -ExecutionPolicy Bypass -File scripts\print-agent\run-agent.ps1`.

**6. Probar**
En la app, abre **/printing** y pulsa **Imprimir prueba**. El indicador debe estar en verde ("agente conectado") y debe salir un ticket.

### Destinos de impresión (en `agent.env`)

Lista separada por comas; se usa el primero que funcione.

| Valor | Para qué |
|-------|----------|
| `win:NOMBRE` | Impresora USB instalada en Windows |
| `tcp:IP` o `tcp:IP:9100` | Impresora de red (cable o WiFi). Ej.: `tcp:192.168.1.60` |
| `file:/dev/usb/lp0` | USB en Linux |

| Variable | Qué imprime |
|----------|-------------|
| `KITCHEN_PRINTER` | Comandas de cocina. **Con una sola impresora basta esta**: barra y facturas la usan también |
| `BAR_PRINTER` | Comandas de bebidas (barra). Si no existe, salen por cocina |
| `RECEIPT_PRINTER` | Facturas (caja). Si no existe, salen por cocina |

Ejemplo con dos impresoras y respaldo: `KITCHEN_PRINTER=win:DigitalPOS` y `BAR_PRINTER=win:DigitalPOS-Barra,tcp:192.168.1.60`.

> El agente corre en el PC que tiene la impresora. `PRINT_AGENT_API_BASE` debe ser la dirección con la que **ese PC** llega al sistema: `http://127.0.0.1:4202/api` si es el mismo PC del servidor; si es otro PC de la red, `http://IP_DEL_SERVIDOR:4202/api`.

### Revisar qué pasa
- Página **/printing**: agente conectado (verde/rojo), cola de tickets (en cola, impreso, error con motivo), botones *Reintentar* y *Ver ticket*.
- Registro del agente: `tmp/print-agent.log`.
- Más detalle técnico: [docs/0070-hardware-printing.md](docs/0070-hardware-printing.md).

---

## 9. Factura electrónica DIAN (Factus)

### Qué es

En Colombia, los restaurantes obligados deben emitir factura electrónica validada por la **DIAN**. El sistema no habla directo con la DIAN: usa **Factus**, un *proveedor tecnológico autorizado* que arma el documento legal (XML/CUFE/QR), lo firma y lo envía a la DIAN. Cada factura o nota crédito consume 1 documento del **paquete** contratado (400 por año).

### Los tres modos (por restaurante, en Configuración → Facturación electrónica)

| Modo | Qué hace | ¿Tiene validez legal? |
|------|----------|----------------------|
| **Apagado (`off`)** | No emite facturas electrónicas | — |
| **Pruebas (`test`)** | Emite en el entorno *sandbox* de Factus con credenciales `DIAN_SANDBOX_*` | **No** |
| **Real (`live`)** | Emite facturas reales con credenciales `DIAN_PROVIDER_*` | **Sí** |

### Qué hay que tener en `config.env` para cada modo

- Pruebas: `DIAN_PROVIDER=factus` y las cuatro `DIAN_SANDBOX_*`.
- Real: `DIAN_PROVIDER=factus`, las cuatro `DIAN_PROVIDER_*` **y** `DIAN_LIVE_UNLOCK=true`.
- `DIAN_PROVIDER=mock` simula todo sin enviar nada (solo para pruebas de programación; **nunca** en producción).

### Pasos para pasar a facturación real

1. **Confirma con tu contador el régimen tributario** (`responsable_iva` o `régimen simple`): cambia si el IVA se discrimina en la factura. Se elige en Configuración → Facturación electrónica.
2. Verifica que la cuenta de Factus tenga los datos reales del negocio (NIT, razón social, rango de numeración autorizado por la DIAN).
3. En `config.env` deja las credenciales de producción y `DIAN_LIVE_UNLOCK=true`; reinicia `back` (sección 5).
4. En la app: Configuración → Facturación electrónica → modo **Pruebas**, emite una factura de prueba de un pedido pagado y revisa que quede validada.
5. Cuando esté todo bien, cambia a **Real**. Desde ese momento cada factura gasta un documento del paquete.
6. Vigila el contador de documentos restantes en esa misma pantalla. Al bajar de `DIAN_PACKAGE_ALERT_BELOW` (40) llega un correo (al correo de contacto del negocio) y aparece un aviso rojo; confírmalo en pantalla. **Cuando recargues el paquete**, actualiza `DIAN_PACKAGE_DOCUMENTS` y `DIAN_PACKAGE_SINCE` en `config.env` y reinicia `back`.

### Reglas importantes

- Solo se factura un pedido que ya está **pagado/completado**.
- Una factura por pedido (no se duplica).
- Para anular se emite una **nota crédito** (también consume documento).
- Propinas no entran en la factura. Falta soporte para impuestos distintos al IVA 01 y para notas crédito parciales (ver doc técnico).
- Si Factus rechaza o no responde, el sistema avisa con error (502) y no marca la factura como emitida.

Detalle técnico: [docs/0078-dian-invoicing.md](docs/0078-dian-invoicing.md).

---

## 10. Credenciales y datos sensibles

> Esta sección existe porque este README es de uso personal. Mantén una copia en tu gestor de contraseñas y **mueve o borra esta sección** si el archivo sale de tu control.

### Aplicación (usuario dueño)

| Dato | Valor |
|------|-------|
| Dirección | http://localhost:4202/login |
| Usuario | `panchopanza_admin2026` |
| Contraseña | `vQ7!mZ2#Lx9@Rk4$Tp8^Wn6&` |

(Definidos en `config.env` → `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD`. Si la cambias desde la app, la de `config.env` deja de ser la vigente.)

### Base de datos (PostgreSQL)

| Dato | Valor |
|------|-------|
| Servidor (desde este PC) | `127.0.0.1`, puerto `5433` |
| Base / usuario / contraseña | `pos` / `pos` / `pos` |

Solo accesible desde el propio PC. Herramienta sugerida: DBeaver o `docker compose exec db psql -U pos -d pos`.

### Factus / DIAN — **producción (real)**

| Dato | Valor |
|------|-------|
| Usuario (correo de la cuenta) | `amandasantos_1975@hotmail.com` |
| Contraseña | `T4O6LEkA` |
| Client ID | `a3079d43-2eba-4b1f-9656-bb9fa6aff3ca` |
| Client Secret | `Vqb7zQGOSrYVAkB77AeSmEBtOh4MNEkdgafA6ZSm` |

### Factus / DIAN — **sandbox (pruebas)**

| Dato | Valor |
|------|-------|
| Usuario | `amandasantos_1975@hotmail.com` |
| Contraseña | `T4O6LEkA` |
| Client ID | `a3079c5d-d37f-43a8-a86c-43f74ee76ec5` |
| Client Secret | `Kh47lkFRPbc9wBgfqASqKos00vpYY56QkyyZD05y` |

Panel web de Factus: https://developers.factus.com.co (sandbox: `https://api-sandbox.factus.com.co`, real: `https://api.factus.com.co`).

### Agente de impresión

| Dato | Valor |
|------|-------|
| Token | `N0-11T67VyV1Znu9tXedTHKXPyVnXXYVTl4rqT66rZg` |
| Impresora | `win:DigitalPOS` |
| Archivo | `scripts/print-agent/agent.env` |

Si se pierde o se filtra el token: Administración → Impresión → borrar el agente → crear uno nuevo → actualizar `agent.env`.

### Claves de sesión (`SECRET_KEY` / `REFRESH_SECRET_KEY`)

Están en `config.env` (no se repiten aquí). **Haz copia de ese archivo completo** en un lugar seguro: si se pierde `SECRET_KEY`, las credenciales de delivery cifradas no se pueden recuperar.

### Dónde está cada secreto (resumen)

| Secreto | Archivo | ¿Va a git? |
|---------|---------|------------|
| Claves de sesión, DB, DIAN, SMTP, Twilio | `config.env` | No (ignorado) |
| Token de impresión | `scripts/print-agent/agent.env` | No (ignorado) |
| Pruebas automáticas | `.env` | No (ignorado) |
| Google Analytics | `.secrets` | No (ignorado) |
| **Este README** | `README.md` | **SÍ (versionado en git local)** |

> Atención: `README.md` **sí** está versionado en git (aunque solo hay repositorio local, sin remoto). No hagas `git push` a ningún servicio externo con las credenciales dentro. Si algún día lo haces, antes quita la sección 10.

---

## 11. Correo y WhatsApp (opcional)

### Correo con Gmail (confirmaciones de reserva, recuperar contraseña)

1. Crea una cuenta de Gmail **solo para el restaurante** (ej. `panchopanza.pos@gmail.com`).
2. Activa la **verificación en dos pasos**: https://myaccount.google.com/security → "Verificación en dos pasos".
3. Crea una **contraseña de aplicación**: https://myaccount.google.com/apppasswords → nombre "PanchoPOS" → *Crear* → copia los 16 caracteres (se ven una sola vez).
4. Elige **una** de las dos formas:
   - **Desde la app:** Configuración → Email (SMTP): host `smtp.gmail.com`, puerto `587`, TLS activado, usuario = el Gmail, contraseña = la de aplicación.
   - **Para todo el sistema (`config.env`):** descomenta y llena `SMTP_HOST`, `SMTP_PORT`, `SMTP_USE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `EMAIL_FROM_NAME`. Reinicia `back`.
5. Para que los correos incluyan enlaces y funcione "Olvidé mi contraseña", define también `PUBLIC_APP_BASE_URL` (dirección pública del sistema).
6. Prueba creando una reserva con un correo real tuyo.

Guía detallada: [docs/0056-gmail-setup.md](docs/0056-gmail-setup.md). Si no llega: [docs/0030-reservation-confirmation-email-troubleshooting.md](docs/0030-reservation-confirmation-email-troubleshooting.md).

### Recordatorios por WhatsApp (Twilio)

1. Crea cuenta en https://www.twilio.com y activa WhatsApp (modo *sandbox* para pruebas o un número aprobado para producción).
2. Copia `Account SID`, `Auth Token` y el número de WhatsApp.
3. Descomenta y llena `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` y pon `DEFAULT_PHONE_COUNTRY=CO` en `config.env`. Reinicia `back`.

---

## 12. Usar el sistema desde internet (túnel o servidor)

Hay tres niveles, de más simple a más serio:

| Opción | Costo | Para qué | Riesgo |
|--------|-------|----------|--------|
| **A. Solo WiFi del local** | $0 | Meseros con tablet/celular dentro del local | Bajo |
| **B. Túnel temporal de Cloudflare** | $0 | Probar desde fuera, o una demo | **Alto si se deja encendido** |
| **C. Servidor con dominio y HTTPS** | Hosting + dominio | Operación seria, QR de mesa y reservas para clientes desde su casa | Medio (con la sección 14 resuelta) |

### A. Solo red local
Es lo descrito en la sección 5 (IP del PC + puerto 4202). La base de datos vive solo en ese PC.

### B. Túnel Cloudflare (fijo, con tu dominio)

Para dejarlo permanente (el PC del local sirve la app y Cloudflare le da HTTPS y una dirección fija):

1. Ten un dominio y agrégalo gratis a Cloudflare (cambiando sus servidores DNS).
2. En https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel → Cloudflared**. Ponle nombre (p. ej. `panchopos`) y copia el **token**.
3. En el túnel, pestaña **Public Hostname**: dominio `pos.tu-dominio.com`, servicio **HTTP** → `haproxy:4202`.
4. En `config.env` (antes de encender; sección 14 explica el porqué):
   - Genera dos secretos distintos: `python -c "import secrets;print(secrets.token_urlsafe(64))"` para `SECRET_KEY` y otra vez para `REFRESH_SECRET_KEY`.
   - `PRODUCTION=true`, `CORS_ORIGINS=https://pos.tu-dominio.com`, `PUBLIC_APP_BASE_URL=https://pos.tu-dominio.com`
   - `CLOUDFLARE_TUNNEL_TOKEN=<el token del paso 2>`
5. Enciende y reinicia el back para que lea la configuración:

```bash
docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.tunnel.yml up -d
docker logs pos-tunnel
```

6. **Recomendado:** en Zero Trust → **Access → Applications**, crea una aplicación para `pos.tu-dominio.com` con login por correo, para que solo tú y tu equipo lleguen a la pantalla de acceso. Si usas QR de mesas o reservas públicas, excluye esas rutas (`/book`, `/m`, `/waitlist`, `/delivery`) de la regla.

### B2. Túnel temporal de prueba (sin dominio)

Sirve para una demo corta. En `docker-compose.tunnel.yml` reemplaza el `command` por `tunnel --no-autoupdate --url http://haproxy:4202` (instrucción en el comentario del archivo) y enciende:

```bash
docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.tunnel.yml up -d cloudflared
docker logs pos-tunnel 2>&1 | grep trycloudflare
```

La dirección `https://algo.trycloudflare.com` cambia cada vez (los QR impresos dejan de servir). Para apagarlo: mismo comando con `stop cloudflared`. **No lo dejes permanente** y no lo uses con los secretos de ejemplo.

### C. Servidor con dominio (producción)

Resumen para quien lo instale (puede ser un técnico):

1. Un servidor Linux con Docker, un dominio apuntando a su IP y puertos 80/443 abiertos.
2. Copiar el proyecto y crear su propio `config.env` con: `SECRET_KEY`/`REFRESH_SECRET_KEY` nuevas, `PRODUCTION=true`, `CORS_ORIGINS=https://tu-dominio.com`, `PUBLIC_APP_BASE_URL=https://tu-dominio.com`, `API_URL=/api`.
3. Certificado HTTPS con Let's Encrypt (certbot): ver [certbot/README.md](certbot/README.md) y [docs/0026-haproxy-ssl-amvara9.md](docs/0026-haproxy-ssl-amvara9.md). HAProxy lee el certificado combinado de `certbot/haproxy-certs/`. **Antes de salir a producción lee la sección 14** (hay ajustes pendientes).
4. Encender: `docker compose --env-file config.env -f docker-compose.yml -f docker-compose.prod.yml up --build -d`
5. Migraciones: `docker compose --env-file config.env exec back python -m app.migrate`
6. El agente de impresión (en el local) cambia `PRINT_AGENT_API_BASE` a `https://tu-dominio.com/api`.

Guía técnica completa: [docs/0004-deployment.md](docs/0004-deployment.md).

---

## 13. Copias de seguridad y recuperación

**Qué hay que respaldar** (todo lo irremplazable):

| Qué | Dónde está | Contiene |
|-----|-----------|----------|
| **Base de datos** | Volumen Docker `pos_pgdata` | Pedidos, productos, usuarios, ventas, reservas, facturas |
| **Imágenes subidas** | `back/uploads/` | Fotos de platos, logo, imagen de marca |
| **Configuración** | `config.env`, `scripts/print-agent/agent.env` | Claves y ajustes |

### Copia de la base de datos

Con el sistema encendido, en Git Bash:

```bash
mkdir -p backups
docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml exec -T db pg_dump -U pos -d pos > backups/pos_$(date +%Y-%m-%d).sql
```

Crea `backups/pos_2026-10-22.sql` (con la fecha del día). La carpeta `backups/` está ignorada por git. **Copia ese archivo a una memoria USB o a un servicio en la nube privado**, no lo dejes solo en el mismo PC. Recomendación: **una copia por día** al cerrar.

### Copia de imágenes y configuración
Copia la carpeta `back/uploads/` y los archivos `config.env` y `scripts/print-agent/agent.env` junto al `.sql`.

### Restaurar una copia (en un sistema nuevo o vacío)

1. Instala y enciende el sistema como en la sección 4.
2. Restaura la base:
```bash
cat backups/pos_2026-10-22.sql | docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml exec -T db psql -U pos -d pos
```
3. Copia `back/uploads/` de vuelta y tu `config.env` original (con las mismas `SECRET_KEY`).
4. Reinicia: `docker compose ... up -d --force-recreate back`.

### ⚠️ Comandos que BORRAN TODO — no usar

| Comando | Efecto |
|---------|--------|
| `docker compose ... down -v` | Borra la base de datos |
| `./run.sh --clean` (o `--remove-all`) | Borra contenedores **y** base de datos |
| `docker volume rm pos_pgdata` | Borra la base de datos |

`down` **sin** `-v` es seguro: apaga sin perder nada. Si por accidente se borra la base, las fotos siguen en `back/uploads/` pero dejan de estar asociadas a los productos: hay que restaurar la copia `.sql`.

---

## 14. Seguridad: lo que debes hacer antes de abrirlo a internet

En el uso local (solo WiFi del local) el riesgo es bajo. Si lo vas a publicar (túnel permanente o servidor), el informe [docs/security-audit-2026-10-22.md](docs/security-audit-2026-10-22.md) lista los puntos pendientes. Resumen:

| Prioridad | Qué | Estado / acción |
|-----------|-----|-----------------|
| Crítica | Claves `SECRET_KEY` / `REFRESH_SECRET_KEY` aleatorias propias | Ya hechas en tu `config.env`. Verifica que no sean el texto `CHANGE_THIS...` |
| Alta | `PRODUCTION=true` (cookies seguras) | Pendiente; solo con HTTPS |
| Alta | `CORS_ORIGINS` con tu dominio exacto, no `*` | Pendiente en producción |
| Alta | El modo producción aún usa el servidor de desarrollo con recarga automática | Pendiente: lo debe corregir un técnico antes de producción real |
| Alta | No dejar el túnel Cloudflare abierto permanentemente | Apágalo al terminar |
| Media | Contraseñas fuertes, 2FA en la cuenta del dueño, un usuario por empleado | Hazlo desde la app |
| Media | Contraseña de la base de datos distinta de `pos` si algún día se expone | Solo si cambias a servidor |

**Buenas prácticas del día a día**
- Cada empleado con **su propio usuario**; al irse alguien, bórrale el acceso en Usuarios.
- Activa **2FA** en la cuenta del dueño y guarda los códigos de recuperación en papel.
- No instales el sistema en un PC de uso compartido sin contraseña de Windows.
- Mantén Windows y Docker Desktop actualizados.

---

## 15. Solución de problemas

| Síntoma | Qué hacer |
|---------|-----------|
| `docker: command not found` / "no se reconoce docker" | Docker Desktop no está instalado o no está abierto. Instálalo/ábrelo y espera el "Engine running" |
| La página no abre (`localhost:4202`) | `docker compose ... ps`: ¿están los 6 contenedores arriba? Si no, `up -d`. Si el puerto 4202 está ocupado por otro programa, cambia `FRONTEND_PORT` en `config.env` |
| Muestra error 503 o "Bad gateway" | El cerebro o la pantalla aún están arrancando (espera 1–2 min) o fallaron: `logs --tail=80 back` y `logs --tail=80 front` |
| No puedo iniciar sesión | Revisa usuario/contraseña (sección 10). Si pusiste `PRODUCTION=true` sin HTTPS, quítalo. Demasiados intentos fallidos bloquean unos minutos |
| Olvidé la contraseña del dueño | Con el sistema encendido, en Git Bash: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T -e NEW_PASSWORD='NuevaClave123!' -e USER_USERNAME='panchopanza_admin2026' back python -m app.seeds.set_user_password` (si omites `USER_USERNAME` cambia el primer usuario creado) |
| El celular no abre la app | Mismo WiFi, usa la IP del PC (`ipconfig`), abre el puerto 4202 en el Firewall de Windows (sección 5) |
| No carga datos / pantalla en blanco | Abre la consola del navegador (F12) y los logs de `back`; confirma que `db` esté `healthy` |
| Los cambios de `config.env` no se aplican | Reinicia: `up -d --force-recreate back ws-bridge` (y `front` si tocaste URLs) |
| No imprime | `/printing`: indicador **rojo** = el agente no corre (revisa `tmp/print-agent.log` y la tarea "PanchoPOS Print Agent" en el Programador de tareas); ticket en **Error** = lee el motivo y pulsa *Reintentar*. Sin ningún agente creado la app no genera comandas |
| "No se encuentra la impresora" | Nombre exacto con `--list-printers`; en `agent.env` debe coincidir `win:NOMBRE` |
| Las bebidas salen en cocina | Falta `BAR_PRINTER` en `agent.env`, o el producto no está en la categoría `Bebidas` ni tiene estación *barra* |
| Se perdieron los datos | ¿Se usó `down -v` o `--clean`? Restaura la copia (sección 13) |
| Las fotos de platos no se ven | Revisa que exista `back/uploads/`; tras borrar la base las fotos quedan sin vínculo (ver [docs/0027-amvara9-menu-images-troubleshooting.md](docs/0027-amvara9-menu-images-troubleshooting.md)) |
| "Olvidé mi contraseña" da error 503 | Falta `PUBLIC_APP_BASE_URL` y/o el correo (SMTP) en `config.env` |
| No llega el correo de reserva | Usa contraseña de **aplicación** de Gmail, TLS activado, revisa spam y [docs/0030](docs/0030-reservation-confirmation-email-troubleshooting.md) |
| Factura DIAN rechazada (error 502) | Credenciales de Factus, rango de numeración vigente, paquete con documentos disponibles, datos del cliente (NIT/nombre) correctos |
| Quiero ver todo lo que pasa | `docker compose ... logs -f` (Ctrl+C para salir; no apaga nada) |

---

## 16. Glosario

| Palabra | Significado simple |
|---------|--------------------|
| **POS** | Punto de venta: el sistema para tomar pedidos y cobrar |
| **Docker / contenedor** | Programa que ejecuta cada parte del sistema en una "cajita" aislada, igual en cualquier PC |
| **Docker Compose** | La "receta" que enciende todas las cajitas juntas |
| **Base de datos** | Donde se guarda toda la información de forma permanente |
| **Migración** | Actualización automática de la estructura de la base de datos al subir versión |
| **Backend / cerebro** | La parte que procesa pedidos y reglas del negocio |
| **Frontend / pantalla** | Lo que ves y tocas en el navegador |
| **HAProxy** | La puerta de entrada que reparte el tráfico |
| **WebSocket** | Conexión permanente que permite avisos en vivo |
| **Token** | Clave larga que identifica a un programa o sesión |
| **`.env` / `config.env`** | Archivo de ajustes y claves |
| **QR de mesa** | Código que lleva al menú de esa mesa |
| **Tenant** | Un restaurante dentro del sistema (aquí solo hay uno) |
| **SMTP** | Protocolo para enviar correos |
| **2FA** | Verificación en dos pasos (contraseña + código) |
| **DIAN** | Entidad colombiana de impuestos |
| **Factus** | Proveedor tecnológico autorizado que emite la factura electrónica |
| **CUFE** | Código único de cada factura electrónica |
| **Sandbox** | Entorno de pruebas sin validez legal |
| **ESC/POS** | Lenguaje de las impresoras térmicas de tickets |
| **Túnel** | Dirección pública temporal hacia tu PC |
| **HTTPS** | Conexión cifrada (candado en el navegador) |

---

## 17. Referencia técnica

*(Solo para quien desarrolle o mantenga el código.)*

### Tecnología
- **Frontend:** Angular 20+ (SPA), Prettier (comillas simples, 100 columnas).
- **Backend:** FastAPI (Python 3.12) + SQLModel; driver `psycopg` v3.
- **Base de datos:** PostgreSQL 18 (Alpine).
- **Tiempo real:** Redis + puente WebSocket (`ws-bridge`).
- **Entrada:** HAProxy 2.8 (`/` → front, `/api` → back, `/ws` → ws-bridge).
- **Despliegue:** Docker Compose con overlays `dev` (puerto 4202, sin HTTPS), `prod` (80/443 + certbot) y `tunnel` (Cloudflare).

### Estructura
```
back/        FastAPI (app/, migrations/, seeds/, tests/, uploads/)
front/       Angular (src/, scripts/ pruebas Puppeteer)
ws-bridge/   Servidor WebSocket
haproxy/     haproxy.cfg (dev) y haproxy.prod.cfg
certbot/     Certificados HTTPS (producción)
scripts/     print-agent/, hooks de git, pruebas de reservas
docs/        Documentación detallada (índice en docs/README.md)
run.sh       Atajo para encender/migrar/limpiar
config.env   Configuración real (ignorado por git)
```

### Reglas de trabajo del repositorio
Ver [AGENTS.md](AGENTS.md): sin `npm install` (usar `npm ci --ignore-scripts`), nada se instala en el host fuera de contenedores, revisar logs del front tras cambios, humo/Puppeteer antes de dar algo por arreglado, no atribuir commits a herramientas. Instalar los hooks de git una vez: `./scripts/install-git-hooks.sh`.

### Pruebas
```bash
# Backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T back python3 -m pytest /app/tests -q
# Reservas (públicas)
./scripts/run-reservation-tests.sh
# Mínima comprobación de vida
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4202/login   # debe dar 200
```
El resto de pruebas Puppeteer están descritas en [docs/testing.md](docs/testing.md).

### Documentación adicional

| Tema | Documento |
|------|-----------|
| Índice de toda la documentación | [docs/README.md](docs/README.md) |
| Despliegue | [docs/0004-deployment.md](docs/0004-deployment.md) |
| HTTPS / certificados | [docs/0026-haproxy-ssl-amvara9.md](docs/0026-haproxy-ssl-amvara9.md) |
| Impresión | [docs/0070-hardware-printing.md](docs/0070-hardware-printing.md) |
| DIAN | [docs/0078-dian-invoicing.md](docs/0078-dian-invoicing.md) |
| Reservas | [docs/0011-table-reservation-user-guide.md](docs/0011-table-reservation-user-guide.md) |
| Domicilios | [docs/0053-satisfecho-delivery-order-channel.md](docs/0053-satisfecho-delivery-order-channel.md) |
| Seguridad | [docs/security-audit-2026-10-22.md](docs/security-audit-2026-10-22.md) |
| Gmail | [docs/0056-gmail-setup.md](docs/0056-gmail-setup.md) |
| Modo sin conexión | [docs/0063-offline-capable-client.md](docs/0063-offline-capable-client.md) |
| Límites de uso (rate limiting) | [docs/0020-rate-limiting-production.md](docs/0020-rate-limiting-production.md) |

---

*Software de uso interno para Pancho Panza, Asadero y Restaurante.*
