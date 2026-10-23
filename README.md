# PanchoPOS — Sistema de Pedidos y Gestión de Pancho Panza

Sistema de punto de venta (POS) para **Pancho Panza, Asadero y Restaurante**. Permite a los meseros tomar y gestionar pedidos, a cocina ver las órdenes en tiempo real, a los clientes pedir desde el celular escaneando un código QR en la mesa, y al propietario administrar mesas, productos, reservas, domicilios, usuarios y reportes.

Es una aplicación propia, de un solo restaurante, que corre en contenedores Docker (frontend en Angular, backend en FastAPI, base de datos PostgreSQL).

---

## ¿Qué incluye?

| Área | Qué hace |
|------|----------|
| **Pedidos** | Ciclo completo: pendiente → preparando → listo → entregado → pagado. La comanda sale sola en la impresora térmica al pasar a "preparando" y la factura se imprime desde el botón del pedido (ver [Impresión](#impresión-de-comandas-y-facturas)). |
| **Impresión** | Impresora térmica de 80 mm por USB, red o WiFi. Comandas automáticas separadas por cocina y barra, facturas con IVA y propina, y la página `/printing` para ver la cola, los errores y reintentar. |
| **Menú para clientes** | El cliente escanea el QR de su mesa, ve el menú, agrega al carrito y pide sin instalar nada. PIN de mesa opcional para evitar pedidos de otras mesas. |
| **Cocina / Bar** | Pantallas de solo lectura (`/kitchen`, `/bar`) con las órdenes en tiempo real y sonido opcional al llegar un pedido nuevo. |
| **Mesas** | Gestión de mesas, código QR por mesa, vista de plano (canvas). |
| **Reservas** | Clientes reservan en `/book/{tenantId}` y pueden ver/cancelar su reserva con un enlace. El personal gestiona todo en `/reservations`, incluye lista de espera y recordatorios. |
| **Domicilios** | Canal de domicilios propio (no es Glovo/Uber): el cliente pide en `/delivery/{tenantId}`, el personal asigna repartidor desde la pestaña Delivery en Pedidos. |
| **Portal de repartidor** | El repartidor inicia sesión en `/courier/login` (o directamente en el login principal) y gestiona sus entregas en `/courier`. |
| **Pagos** | Efectivo, datafono (tarjeta en físico). |
| **Factura electrónica (Colombia / DIAN)** | Módulo de prueba (modo simulación) para emitir facturas/notas crédito ante la DIAN vía un proveedor tecnológico certificado. Activable desde Configuración una vez se tengan credenciales reales; ver [docs/0078-dian-invoicing.md](docs/0078-dian-invoicing.md). |
| **Usuarios y roles** | Owner (control total), mesero, cocina, repartidor. El cliente final nunca necesita cuenta. |
| **Reportes** | Ventas, por producto/categoría/mesa/mesero, exportable a CSV/Excel, en `/reports`. |
| **Inventario** | Insumos, proveedores, órdenes de compra y stock. |

---

## Tecnología usada

- **Frontend:** Angular 20+ (SPA)
- **Backend:** FastAPI (Python) con SQLModel como ORM
- **Base de datos:** PostgreSQL 18
- **Cache / tiempo real:** Redis + WebSocket para actualizar pedidos en vivo
- **Despliegue:** Docker Compose + HAProxy como punto de entrada único

---

## Primeros pasos (instalación)

### Requisitos

- [Docker](https://docs.docker.com/get-docker/) y [Docker Compose](https://docs.docker.com/compose/install/) instalados.
- No se necesita instalar Node.js, Python ni Postgres en la máquina: todo corre dentro de contenedores.

### Paso a paso

1. **Entrar a la carpeta del proyecto**
   ```bash
   cd pos-master
   ```

2. **Crear el archivo de configuración**
   ```bash
   cp config.env.example config.env
   ```
   Los valores por defecto ya sirven para probar en tu propia computadora. No es necesario cambiar nada para el primer arranque.

3. **Levantar todos los servicios**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file config.env up -d
   ```
   Esto descarga/arma las imágenes la primera vez (puede tardar unos minutos) y deja corriendo: base de datos, backend, frontend y el proxy que une todo.

4. **Confirmar que todo quedó arriba**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
   ```
   Busca la fila `haproxy` y revisa la columna `PORTS`: normalmente dice `0.0.0.0:4202->4202/tcp`. Ese `4202` es el puerto donde vive la aplicación.

5. **Abrir la aplicación**
   En el navegador: **http://localhost:4202**

6. **Iniciar sesión**
   La cuenta del propietario ya existe (no se necesita crear una cuenta nueva). Inicia sesión con el usuario y la contraseña del restaurante.

7. **Revisar que todo funcione**
   - `http://localhost:4202/dashboard` → panel del personal.
   - `http://localhost:4202/kitchen` → pantalla de cocina.
   - Escanea el QR de una mesa (desde `Mesas` en el panel) para probar el menú del cliente.

### Para detener el sistema

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file config.env down
```

Esto apaga los contenedores sin borrar la base de datos (los datos quedan guardados). **No** usar `down -v`, ya que eso sí borra toda la información.

---

## Accesos directos (con la app corriendo en el puerto 4202)

| Qué es | URL |
|--------|-----|
| Panel del personal | http://localhost:4202/dashboard |
| Inicio de sesión | http://localhost:4202/login |
| Pedidos | http://localhost:4202/orders |
| Mesas | http://localhost:4202/tables |
| Cocina | http://localhost:4202/kitchen |
| Bar | http://localhost:4202/bar |
| Reservas (personal) | http://localhost:4202/reservations |
| Reportes | http://localhost:4202/reports |
| Impresión (cola y errores) | http://localhost:4202/printing |
| Configuración | http://localhost:4202/settings |
| Usuarios | http://localhost:4202/users |
| Reserva pública (cliente) | http://localhost:4202/book/{tenantId} |
| Lista de espera (cliente) | http://localhost:4202/waitlist/{tenantId} |
| Domicilios (cliente) | http://localhost:4202/delivery/{tenantId} |
| Portal del repartidor | http://localhost:4202/courier |
| Documentación de la API (Swagger) | http://localhost:4202/api/docs |
| Estado del sistema | http://localhost:4202/api/health |

> `{tenantId}` es el identificador del restaurante en el sistema; se obtiene desde Configuración.

---

## Impresión de comandas y facturas

La app no habla directo con la impresora: un pequeño programa, el **agente de impresión** (`scripts/print-agent/`), corre en el PC que tiene la impresora, consulta la cola cada segundo y manda los tickets en formato ESC/POS.

**Qué sale solo**
- **Comanda:** cuando un plato pasa a *preparando* (automático al minuto, o antes si el personal lo cambia). Cada plato sale una sola vez; si el cliente pide más, sale otra comanda `ADICION` solo con lo nuevo. Los platos se separan por estación: **cocina** y **barra** (las categorías `Bebidas`/`Beverages` van a barra, o la estación que asignes al producto).
- **Factura:** al pulsar *Imprimir factura* en el pedido (negocio, cliente de facturación, detalle, propina, IVA y total).
- Si no hay agente conectado, el botón cae al diálogo de impresión del navegador.

**Puesta en marcha (Windows, impresora USB)**
1. Conecta la impresora, instálala en Windows y anota su nombre (`python scripts/print-agent/print_agent.py --list-printers`). Si Windows no la lista, créala con el driver "Generic / Text Only" en el puerto USB.
2. En **Administración → Impresión** pulsa *Crear agente* y copia el token (se muestra una sola vez).
3. Copia `scripts/print-agent/agent.env.example` a `scripts/print-agent/agent.env` (no se sube a git) y completa el token y los destinos.
4. Registra el arranque automático al iniciar sesión: `powershell -ExecutionPolicy Bypass -File scripts\print-agent\install-autostart.ps1` (quitar con `-Remove`).
5. Pulsa *Imprimir prueba* en la página Impresión.

**Destinos de impresión** (en `agent.env`; lista separada por comas, se usa el primero que funcione):

| Valor | Para qué |
|-------|----------|
| `win:NOMBRE` | Impresora instalada en Windows (USB) |
| `tcp:IP[:9100]` | Impresora de red (cable o WiFi) |
| `file:/dev/usb/lp0` | USB en Linux |

Variables: `KITCHEN_PRINTER` (cocina), `BAR_PRINTER` (barra) y `RECEIPT_PRINTER` (facturas). **Con una sola impresora** basta `KITCHEN_PRINTER`: barra y facturas la usan también. **Con dos**, pon la segunda en `BAR_PRINTER` y las bebidas salen allí. Ejemplo: `KITCHEN_PRINTER=win:DigitalPOS` y `BAR_PRINTER=win:DigitalPOS-Barra,tcp:192.168.1.60`.

**Ver qué pasa:** la página `/printing` muestra si el agente está conectado, la cola con el estado de cada ticket (en cola, impreso, error con su motivo), el botón *Reintentar* y *Ver ticket*. El log del agente está en `tmp/print-agent.log`. Más detalle técnico en [docs/0070-hardware-printing.md](docs/0070-hardware-printing.md).

---

## Modo gratuito (solo red local)

Si en algún momento no se quiere pagar el hosting en internet, el mismo stack de Docker puede levantarse en una computadora del local y quedar disponible solo para los dispositivos conectados a la misma red WiFi del restaurante (meseros con tablet/celular, sin necesidad de dominio ni de internet). Limitaciones de este modo: la base de datos es independiente de la versión en la nube (no se sincroniza sola) y solo funciona dentro de la red WiFi del local, no desde fuera.

---

## Configuración (`config.env`)

Variables más relevantes (ver `config.env.example` para la lista completa, con comentarios):

| Variable | Para qué sirve |
|----------|-----------------|
| `SECRET_KEY` / `REFRESH_SECRET_KEY` | Firman las sesiones de inicio de sesión. Deben cambiarse por valores aleatorios en producción. |
| `POSTGRES_*` / `DB_*` | Conexión a la base de datos. |
| `API_URL` / `WS_URL` | A dónde apunta el frontend para hablar con el backend (se deja igual en desarrollo local). |
| `CORS_ORIGINS` | Dominios permitidos para hablar con la API. |
| `SMTP_*` / `EMAIL_FROM` | Correo para confirmaciones de reserva (opcional). |
| `TWILIO_*` | Recordatorios de reserva por WhatsApp (opcional). |

Los datos del negocio (teléfono, dirección, horario, moneda, impuestos) se configuran directamente en **Configuración** dentro de la aplicación, no en este archivo.

---

## Mantenimiento y desarrollo

### Ver registros (logs) para detectar errores

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=80 front
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=50 back
```

### Reiniciar solo el backend (sin perder datos)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart back
```

### Migraciones de base de datos

Se aplican solas al iniciar el backend. Para aplicarlas manualmente:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec back python -m app.migrate
```

### Pruebas automáticas del backend

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T back python3 -m pytest /app/tests -q
```

Más detalle de convenciones de trabajo en este proyecto: [AGENTS.md](AGENTS.md).

---

## Arquitectura

```
Navegador → Frontend (Angular) → Backend (FastAPI) → PostgreSQL
                                      ↓
                                 Redis (pub/sub)
                                      ↓
                            WebSocket → Navegador (tiempo real)
```

**Servicios (Docker Compose):**

- **haproxy** — único punto de entrada; reparte `/` al frontend, `/api` al backend, `/ws` al puente de WebSocket.
- **front** — aplicación Angular.
- **back** — API en FastAPI.
- **ws-bridge** — servidor de WebSocket para actualizaciones en vivo de pedidos.
- **db** — PostgreSQL.
- **redis** — cache y mensajería en tiempo real.

---

## Solución de problemas

| Problema | Qué revisar |
|----------|-------------|
| Los contenedores no arrancan | `docker compose -f docker-compose.yml -f docker-compose.dev.yml logs`; revisar que no haya otro proceso usando el mismo puerto. |
| El frontend no carga datos | Revisar la consola del navegador y los logs de `back`; confirmar que `db` esté sano con `docker compose ... ps`. |
| No carga en el puerto esperado | Confirmar el puerto real con `docker compose ... ps` (columna `PORTS` de `haproxy`). |
| Errores de base de datos | Confirmar credenciales en `config.env` y que el servicio `db` esté arriba. |
| No imprime | Abrir `/printing`: si el indicador está en rojo el agente no corre (revisar `tmp/print-agent.log` y la tarea "PanchoPOS Print Agent"); si el ticket está en *Error*, leer el motivo y pulsar *Reintentar*. Sin ningún agente creado la app no genera comandas. |
| Windows dice que no encuentra la impresora | Comprobar el nombre exacto con `--list-printers` y que `win:NOMBRE` en `agent.env` coincida. |
| Las bebidas salen en la impresora de cocina | Falta `BAR_PRINTER` en `agent.env`, o el producto no está en la categoría `Bebidas` ni tiene estación de barra. |

---

## Licencia

Software de uso interno para Pancho Panza, Asadero y Restaurante.
