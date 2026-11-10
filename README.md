# Delfos

Observatorio de compras ejecutadas en Polymarket sobre Polygon. Backend Node.js/TypeScript, PostgreSQL, React/Vite/Tailwind, WebSockets y despliegue con Docker Compose. Solo lectura: no utiliza claves de billetera ni realiza operaciones.

## Arranque

La copia entregada incluye `.env` con una contraseña aleatoria de PostgreSQL. Desde la carpeta `Delfos`:

```sh
docker compose up --build -d
```

Abre http://localhost:8080. Para el VPS, configura antes `PUBLIC_ORIGIN=https://tu-dominio` (o `http://IP:8080`) en `.env`; debe coincidir exactamente con el origen usado por el navegador. Coloca tu proxy HTTPS delante del puerto 8080 y habilita el upgrade WebSocket de `/ws`. Si el proxy está en el mismo host, puedes establecer `BIND_ADDRESS=127.0.0.1`. PostgreSQL y el backend no publican puertos al host.

Si obtienes el código sin `.env`, ejecuta `sh scripts/setup.sh` una vez. Requiere OpenSSL y crea una contraseña hexadecimal compatible con la URL de PostgreSQL, sin sobrescribir configuración existente. No subas `.env` a Git. No cambies la contraseña del archivo después de inicializar el volumen sin actualizar también el usuario de PostgreSQL.

```sh
docker compose ps
docker compose logs -f backend
docker compose down
```

`down` conserva la base de datos. `down -v` la elimina: no lo uses para actualizar. Para actualizar el código, vuelve a ejecutar `docker compose up --build -d`. Los contenedores se ejecutan sin root en backend/frontend, con filesystem de solo lectura, límites de memoria y rotación de logs. Recomendación inicial: VPS con 2 vCPU, 2 GB de RAM y espacio monitorizado para PostgreSQL; el tamaño requerido depende del tráfico y de la retención.

## Qué cuenta como apuesta

1. Se consultan eventos `OrderFilled` de los Exchange verificados, con `side=BUY`.
2. El propietario es `maker` del evento. La orden taker también emite su propio `OrderFilled`; no se crea una compra adicional desde `taker`, ni desde `OrdersMatched`.
3. Se agrupan ejecuciones por **transacción + billetera + Token/Position ID**, sumando colateral y participaciones. Una orden dividida entre transacciones distintas se evalúa por separado. Dos resultados distintos nunca se suman.
4. Los importes se comparan como enteros `BigInt` con seis decimales, sin comisiones. Los umbrales son estrictamente `>`.
5. Se excluyen ventas, transferencias, depósitos, retiradas, redenciones, splits y merges como eventos independientes. Una compra ejecutada mediante matching/minting sí se reconoce por su `OrderFilled`.

| Condición | Resultado |
| --- | --- |
| Más de $10.000 y primera actividad pública verificada | Posible Insider |
| Más de $10.000 y actividad anterior conocida | Ballena |
| Más de $10.000 e historial no verificable | Historial desconocido, pendiente de reintento |
| Cuenta recurrente con compra de $10.000 o menos | Se conserva para historial, sin alerta |

La señal de Insider no demuestra la edad de la cuenta, su identidad, otras billeteras relacionadas ni información privilegiada. Se utiliza la billetera propietaria de la orden (proxy/deposit wallet), no necesariamente el firmante EOA.

El historial público se consulta en `/v2/activity?type=TRADE&start=1&sort_direction=ASC`, sin filtrar solo takers o solo compras. `start=1` evita la ventana temporal predeterminada de la API. Se siguen cursores; errores, esquemas inesperados y páginas incompletas nunca se interpretan como ausencia de historial. Para declarar primera actividad, esta transacción debe estar visible en el índice público. Otra transacción del mismo segundo se trata conservadoramente como actividad existente. Compras anteriores observadas localmente también acreditan recurrencia.

La API pública puede tener retrasos o carencias históricas. La etiqueta significa **primera actividad según el historial disponible**, no una garantía criptográfica de inexistencia de operaciones previas. Los casos desconocidos se reintentan con espera creciente hasta una hora. Delfos no necesita esperar a esa comprobación para seguir indexando bloques.

## Contratos y APIs actuales

La implementación utiliza el formato de `OrderFilled` de CTF Exchange domain v2 y ExchangeV3 domain v3:

| Contrato | Dirección Polygon |
| --- | --- |
| CTF Exchange v2 | `0xe111180000d2663c0091e4f400237545b87b996b` |
| Neg Risk CTF Exchange v2 | `0xe2222d279d744050d28e00520010520000310f59` |
| ExchangeV3 / PositionManager | `0xe3333700ca9d93003f00f0f71f8515005f6c00aa` |

El colateral actual es **pUSD**, no una transferencia directa de USDC. Los importes USD son nominales asumiendo paridad 1:1; no incorporan un oráculo de tipo de cambio. El sistema no escucha el `Transfer` de USDC para inferir apuestas.

CLOB `/markets-by-token/{token_id}` resuelve la condición. Gamma `/markets?condition_ids=…` aporta pregunta, slug y etiquetas, verificando la correspondencia exacta del Token/Position ID. Se traducen Yes/No a SÍ/NO y se preservan nombres de equipos u otros resultados. CLOB `/midpoint?token_id=…` aporta una referencia actual del libro. El precio de ejecución se calcula por separado: colateral / participaciones. El midpoint no es una probabilidad objetiva ni una cotización ejecutable garantizada.

Los metadatos fallidos permanecen pendientes. Las cotizaciones de las 200 alertas recientes y del ranking se renuevan de forma periódica (hasta 100 de cada vista por ciclo); las referencias mayores de tres minutos se ocultan. Una API sin cotización no se sustituye por el precio de ejecución.

Fuentes consultadas el 9 de noviembre de 2026:

- [Contratos oficiales](https://docs.polymarket.com/resources/contracts)
- [Indexación de ambos sistemas de posiciones](https://docs.polymarket.com/resources/onchain-position-data)
- [Eventos y ABI del Exchange](https://github.com/Polymarket/ctf-exchange-v2/blob/main/src/exchange/mixins/Events.sol)
- [Semántica de liquidación del Exchange](https://github.com/Polymarket/ctf-exchange-v2/blob/main/src/exchange/mixins/Trading.sol)
- [OpenAPI Data v2](https://data-api.polymarket.com/v2/openapi.json)
- [OpenAPI CLOB](https://docs.polymarket.com/api-spec/clob-openapi.yaml)
- [OpenAPI Gamma](https://docs.polymarket.com/api-spec/gamma-openapi.yaml)
- [Migración de Data API v1 a v2](https://docs.polymarket.com/migrate/data-api-v1-to-v2)

Los antiguos contratos CTF Exchange v1 (formato `makerAssetId/takerAssetId`) **no** están incluidos en el escaneo. `START_BLOCK` sirve para relectura histórica de los contratos soportados, no para reconstruir toda la historia de Polymarket. Las cuentas se contrastan con la API pública, que sí permite consultar actividad anterior a la instalación.

## Arquitectura

```text
Polygon RPC → Scanner → decodePurchases → PostgreSQL (compras + cursor + trabajos)
                                                 ↓
                          EnrichmentWorker → Data API / CLOB / Gamma
                                                 ↓
                                     alertas persistentes
                                                 ↓
                          WebSocket invalidate → /api/snapshot → React
```

```text
Delfos/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json / package-lock.json / tsconfig.json
│   ├── src/
│   │   ├── index.ts         # Composición, Express, Pool, WebSockets y cierre
│   │   ├── config.ts        # Validación de configuración
│   │   ├── logger.ts        # Logs operativos
│   │   ├── domain.ts        # ABI, normalización, agrupación y umbrales
│   │   ├── scanner.ts       # Lectura confirmada y recuperación de ramas
│   │   ├── store.ts         # Esquema SQL, transacciones y consultas
│   │   ├── http.ts          # Timeouts y reintentos HTTP
│   │   ├── polymarket.ts    # Historial, correspondencia de IDs y precios
│   │   └── enrichment.ts   # Cola persistente y clasificación
│   └── test/               # Pruebas de dominio, APIs e integración
├── frontend/
│   ├── Dockerfile / nginx.conf
│   ├── package.json / package-lock.json
│   ├── vite.config.ts / tailwind.config.js / postcss.config.js
│   ├── index.html / public/favicon.svg
│   └── src/
│       ├── App.tsx         # Dashboard, ranking, búsqueda y detalle
│       ├── useFeed.ts      # Reconexión y sincronización
│       ├── types.ts
│       ├── main.tsx
│       └── styles.css
└── scripts/
    ├── setup.sh
    └── test-integration.sh
```

La base registra todas las compras observadas, incluidas las pequeñas, para reconocer antecedentes. La vista `wallets` calcula primera/última observación, compras y volumen; se corrige automáticamente al retirar una rama. El ranking se ordena con columnas SQL numéricas, no cadenas. Los modelos HTTP transportan cantidades monetarias como strings decimales.

El scanner conserva hashes de checkpoints y verifica todos los enlaces padre-hijo de cada rango. Compras, trabajos y cursor se confirman en una sola transacción. Ante una reorganización se busca un checkpoint común, se eliminan compras huérfanas y sus alertas/trabajos por cascada y se reproduce la cadena. Un trabajador que termina tarde no puede resucitar una alerta eliminada. Se conserva una ventana de 10.000 bloques de checkpoints más el ancla inicial; si no existe punto común, el servicio informa del problema y no avanza silenciosamente.

Un bloqueo consultivo PostgreSQL permite un único indexador/trabajador por base de datos. No escales el servicio backend a varias réplicas con esta configuración. Los WebSockets notifican después del commit; el navegador vuelve a pedir una instantánea, lo que también recupera cambios perdidos, correcciones y eliminaciones. Hay heartbeat, reconexión con espera creciente y consulta HTTP de respaldo cada 15 segundos.

## Configuración

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `POLYGON_RPC_URL` | `https://polygon-bor-rpc.publicnode.com` | RPC HTTP Polygon |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Origen permitido en WebSocket |
| `CONFIRMATIONS` | `20` | Profundidad antes de procesar |
| `POLL_INTERVAL_MS` | `4000` | Intervalo cuando está al día |
| `BLOCK_BATCH_SIZE` | `30` | Bloques por consulta de logs |
| `INITIAL_LOOKBACK_BLOCKS` | `300` | Ventana inicial si no hay cursor |
| `START_BLOCK` | vacío | Inicio explícito; solo en una base nueva |
| `WHALE_USD` | `10000` | Umbral de recurrentes |
| `INSIDER_USD` | `10000` | Umbral para primera actividad |
| `DELFOS_LOG_FORMAT` | `text` | Logs legibles; `json` para agregadores |
| `IPV4_ONLY` | `true` | Prioriza IPv4 y desactiva la selección automática de familia; evita fallos en hosts Docker sin salida IPv6 |
| `CLOB_API_URL`, `GAMMA_API_URL`, `DATA_API_URL` | APIs oficiales | Endpoints parametrizables |
| `EXCHANGE_ADDRESSES` | Los tres contratos anteriores | Solo contratos con la ABI soportada |
| `HTTP_PORT`, `BIND_ADDRESS` | `8080`, `0.0.0.0` | Puerto publicado del dashboard |

`polygon-rpc.com` devolvió un error de tenant/API deshabilitada durante la comprobación, por lo que se eligió PublicNode tras verificarlo. Puedes cambiar de proveedor sin perder el cursor. Un RPC público no ofrece SLA; si limita rangos, reduce `BLOCK_BATCH_SIZE`. Para carga sostenida usa un proveedor con cuota adecuada y acceso a los bloques que necesites recuperar.

“Tiempo real” aquí significa liquidación on-chain **después de confirmaciones**, más latencia de sondeo y enriquecimiento. No observa órdenes sin ejecutar ni el mempool. El dashboard muestra retraso y errores; una conexión WebSocket abierta no se presenta como garantía de que Polygon esté al día.

Cambiar umbrales no reclasifica automáticamente compras históricas: aplícalos antes del arranque o prepara una migración/reencolado para el intervalo deseado. Los datos de compras crecen sin purga automática; configura monitorización del disco y una política de archivo compatible con el historial que quieras conservar.

## API y operación

- `GET /api/snapshot`: hasta 200 alertas recientes, 200 mayores, estadísticas y estado.
- `GET /api/wallets/:address`: historial agregado observado localmente.
- `WS /ws`: notificaciones de invalidación; origen permitido, límite de clientes y heartbeat.
- `GET /health/live`: proceso HTTP disponible (healthcheck del contenedor).
- `GET /health/ready`: PostgreSQL y scanner reciente; responde 503 si no está operativo. Accesible dentro de la red Docker, no publicado por Nginx.

La interfaz es de lectura pública para quien alcance el puerto. Si deseas acceso privado, añade autenticación en tu proxy HTTPS o limita el acceso de red. No hay secretos incorporados al bundle del frontend. Las APIs SQL usan parámetros; no se escriben URLs de RPC con posibles credenciales en los logs.

Los logs muestran un resumen del scanner cada minuto (bloques, eventos, compras, candidatos, cursor y retraso), una línea por alerta creada/actualizada y errores o reorganizaciones. Se agrupan errores repetidos durante 60 segundos. `DELFOS_LOG_FORMAT=text` produce líneas legibles; `json` permite integrarlos en un agregador. No se registra cada compra pequeña ni se incluyen explicaciones educativas. Docker limita cada servicio a cinco archivos de 10 MB.

Copia de seguridad:

```sh
mkdir -p backups
docker compose exec -T postgres pg_dump -U delfos -d delfos -Fc > backups/delfos.dump
```

Ensaya la restauración en otra base antes de usarla en producción. Conserva por separado `.env` y el backup. Los cambios futuros del esquema deben añadirse como migraciones explícitas; la inicialización v1 es idempotente y registra `schema_migrations`.

## Desarrollo y comprobación

Node.js 22 o superior. Para desarrollo local necesitas un PostgreSQL accesible y `DATABASE_URL`; carga tus variables mediante el entorno o `node --env-file` (no hay carga implícita de dotenv). Si usas Vite en 5173, establece `PUBLIC_ORIGIN=http://localhost:5173` en el backend. Vite proxifica `/api` y `/ws` al puerto 3001.

```sh
cd backend
npm ci
npm test
npm run build
# DATABASE_URL y PUBLIC_ORIGIN configurados en el entorno:
npm run dev
```

En otra terminal:

```sh
cd frontend
npm ci
npm run dev
```

Las pruebas de integración usan exclusivamente `delfos_test`; el script la crea si no existe y reinicia sus tablas de prueba. Con Compose levantado:

```sh
sh scripts/test-integration.sh
```

Comprueban idempotencia, atomicidad del cursor, rollback SQL, historial local, enriquecimiento, avisos al frontend, fallos RPC y reorganizaciones con eliminación de alertas huérfanas. Las pruebas unitarias cubren BUY/SELL, cantidades exactas, duplicación, agrupación y estados de historial/API.

No se han ejecutado pruebas de carga sostenida ni una auditoría externa. Verifica los parámetros y la capacidad del RPC en el VPS antes de depender de la continuidad del servicio.

## Cuentas relacionadas y valoración de venta

El badge de cuenta solo aparece cuando la misma dirección completa tiene alertas en al menos dos eventos Gamma diferentes y dos transacciones diferentes. No se deducen identidades por nombres, similitud de direcciones ni relaciones entre billeteras. El badge filtra hasta 200 alertas de esa cuenta desde PostgreSQL; el número de eventos se calcula sobre todas sus alertas guardadas, no solo sobre la página visible. Los grupos se recalculan tras reorganizaciones.

Los enlaces usan `/event/{eventSlug}/{marketSlug}` con el evento padre obtenido de Gamma. No se utiliza la antigua ruta `/market/`.

En Más info, `GET /api/valuation?id=…` consulta `/book` de CLOB. Valida el Token ID, exige una instantánea de menos de 60 segundos y recorre los bids desde el precio más alto. Calcula con enteros de seis decimales el ingreso bruto para vender las participaciones originales y resta su coste de compra, sin comisiones. El precio actual mostrado es el punto medio entre la mejor compra y la mejor venta, separado del precio medio de venta que resulta al consumir liquidez.

La estimación es hipotética: no confirma que la billetera conserve esa cantidad ni atribuye ventas posteriores a un lote concreto. No incluye comisiones, gas ni posibles cambios del libro antes de ejecutar; no representa una ganancia realizada o garantizada. Si falta liquidez para la cantidad completa, el libro está desactualizado, cruza precios o no está disponible, no se publica un resultado bruto de venta completa. La consulta se actualiza cada 30 segundos mientras el detalle esté abierto.
