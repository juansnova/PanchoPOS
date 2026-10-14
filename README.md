# PanchoPOS — Sistema de Pedidos y Gestión de Pancho Panza

Sistema de punto de venta (POS) para **Pancho Panza, Asadero y Restaurante**. Permite a los meseros tomar y gestionar pedidos, a cocina ver las órdenes en tiempo real, a los clientes pedir desde el celular escaneando un código QR en la mesa, y al propietario administrar mesas, productos, reservas, domicilios, usuarios y reportes.

Es una aplicación propia, de un solo restaurante, que corre en contenedores Docker (frontend en Angular, backend en FastAPI, base de datos PostgreSQL).

---

## ¿Qué incluye?

| Área | Qué hace |
|------|----------|
| **Pedidos** | Ciclo completo: pendiente → preparando → listo → entregado → pagado. Impresión de factura/recibo desde el navegador. |
| **Menú para clientes** | El cliente escanea el QR de su mesa, ve el menú, agrega al carrito y pide sin instalar nada. PIN de mesa opcional para evitar pedidos de otras mesas. |
| **Cocina / Bar** | Pantallas de solo lectura (`/kitchen`, `/bar`) con las órdenes en tiempo real y sonido opcional al llegar un pedido nuevo. |
| **Mesas** | Gestión de mesas, código QR por mesa, vista de plano (canvas). |
| **Reservas** | Clientes reservan en `/book/{tenantId}` y pueden ver/cancelar su reserva con un enlace. El personal gestiona todo en `/reservations`, incluye lista de espera y recordatorios. |
| **Domicilios** | Canal de domicilios propio (no es Glovo/Uber): el cliente pide en `/delivery/{tenantId}`, el personal asigna repartidor desde la pestaña Delivery en Pedidos. |
| **Portal de repartidor** | El repartidor inicia sesión en `/courier/login` (o directamente en el login principal) y gestiona sus entregas en `/courier`. |
| **Pagos** | Efectivo, datafono (tarjeta en físico), o pago en línea con Revolut si se configura. |
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
| `REVOLUT_MERCHANT_SECRET` | Pago en línea con Revolut (opcional; también se configura por restaurante en Configuración). |

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

---

## Licencia

Software de uso interno para Pancho Panza, Asadero y Restaurante.
