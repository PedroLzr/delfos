# Verificación de Delfos

Fecha: 9 de noviembre de 2026 (Europe/Madrid).

- Compilación TypeScript del backend: correcta.
- Compilación TypeScript y bundle Vite del frontend: correctos.
- Pruebas unitarias: 19 aprobadas.
- Integración PostgreSQL/scanner/worker: 7 escenarios aprobados, incluida recuperación tras errores, rollback de reorganizaciones, deduplicación y preservación de metadatos ante fallos transitorios.
- Docker Compose: configuración válida, builds multi-stage correctos, tres servicios healthy.
- HTTP: dashboard y snapshot responden 200; readiness comprobada con indexador al día.
- WebSocket: handshake y aviso de sincronización verificados; origen ajeno rechazado con 403.
- Navegador: dashboard, WebSocket conectado, modal de metodología, ranking y búsqueda comprobados.
- Prueba real Polygon: compra de 21.830,8704 pUSD, precio medio 0,96, clasificada como Ballena tras consultar historial público.
- Hash observado: `0x29e872e1c9824c597d4701efeea5ce7e5168c2d2c19b3265557b4ad35aacfa11`. Bloque: 97034130.
- Reinicios durante builds conservaron el cursor y el historial.

Las APIs públicas produjeron fallos transitorios: se verificaron estados pendientes y reintentos. El código prioriza IPv4 para evitar problemas de conectividad IPv6 del entorno Docker.

No se han realizado auditoría externa, pruebas prolongadas de carga ni despliegue en el VPS del usuario. El paquete no incluye la base de datos de esta prueba: una instalación nueva comenzará en su ventana inicial configurada.

## Actualización de interfaz y logs

Se retiraron cabecera promocional, tarjetas de métricas, aviso de contexto y texto de pie. Tabla simplificada con resultado explícito, precios en pUSD, importe antes de señal y botón Más info. Billetera solo en detalle. Verificado en navegador con alertas reales.

Backend y frontend compilan. 19 pruebas unitarias y 7 escenarios de integración aprobados. Logs operativos con resumen por minuto, alertas y errores; limitación de errores repetidos y ocultación de URLs comprobadas. Formato legible predeterminado; DELFOS_LOG_FORMAT=json disponible.

## Actualización: cuentas y estimación de venta

- Eliminadas la barra lateral completa y la insignia Polygon del header.
- Etiqueta Apuesta: aplicada en tabla y detalle.
- Umbral general reducido a más de 10.000; reprocesadas las compras existentes.
- Menú de señales oscuro verificado visualmente.
- Agrupación por dirección completa, con eventos Gamma y transacciones diferentes; filtro de cuenta comprobado en navegador.
- Precio actual y estimación bruta de venta comprobados con un libro real. La profundidad puede producir pérdida aunque el midpoint esté por encima del precio pagado.
- Enlaces corregidos a /event/{eventSlug}/{marketSlug}. La carga externa no pudo verificarse: polymarket.com devolvió ERR_CONNECTION_RESET tanto en navegador como por HTTP.
- Compilaciones backend/frontend y Docker correctas; 24 pruebas unitarias y 8 escenarios de integración aprobados.
- Las pruebas incluyen liquidez insuficiente, orden de bids, resultado negativo, libro caducado/cruzado y agrupación de cuentas tras reorganizaciones.
