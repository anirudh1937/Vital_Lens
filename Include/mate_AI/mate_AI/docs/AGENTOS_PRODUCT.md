# AGENTOS + Mate AI — Product Build Plan

This keeps the device-side AGENTOS workstream separate while defining how it will later integrate with Mate AI.

## Vision
- Run full ReAct agents on $5–$10 MCUs (STM32F4-class) with no cloud dependency.
- Mate AI remains the multi-model chat + orchestration layer for desktop/web; AGENTOS handles real-world action via MCP tools.
- Clear boundary: Mate AI produces goals/intents; AGENTOS executes them deterministically on-device with safety rails.

## Components
- **Mate AI (existing app/server)**
  - Chat UI, RAG, model policies, quotas, monitoring.
  - New bridge service: translates user intents → MCP tool calls/package for AGENTOS devices.
- **AGENTOS Device Stack**
  - FreeRTOS extension (deterministic scheduling, MPU isolation, watchdog).
  - TinyLLM runtime (2 MB INT4, flash+SRAM KV-cache, ~5 tok/s).
  - Agent engine (ReAct, planning, memory).
  - MCP tools bound to HAL (GPIO/ADC/PWM/UART/SPI/I2C/LoRa).
- **Transport**
  - Primary: local serial/USB or UART-over-BLE for dev.
  - Field: LoRa or Wi‑Fi MQTT (topic-per-device) with signed envelopes.

## Integration Surface (Mate ↔ AGENTOS)
- **Command envelope**
  - `deviceId`, `sessionId`, `goal`, optional `plan`, safety limits (actuator bounds, time budget), and `traceId`.
  - Signed HMAC with shared device key; nonce to prevent replay.
- **Result envelope**
  - `status`, `observations`, `toolCalls`, `latencyMs`, `tokensUsed`, `logs`, optional `failReason`.
- **APIs to add (server.js future)**
  - `POST /api/agentos/devices/:id/goal` — enqueue goal to device bridge.
  - `GET /api/agentos/devices/:id/telemetry` — stream recent observations/logs.
  - `WS /api/agentos/stream` — bidirectional goals/telemetry for online devices.

## Phased Build
1) **Sandbox firmware**: Run AGENTOS demo (voice → LED/motor) on STM32F446RE; log timings.
2) **Bridge prototype**: Small Node service that wraps goals, signs envelopes, pushes over serial; reads telemetry back.
3) **Mate integration (lightweight)**: Add `/api/agentos/devices` endpoints and a chat slash-command (`/agentos goal="turn on led"`).
4) **Safety & quotas**: Map Mate user/org to device keys; enforce actuator envelopes and per-user rate limits.
5) **Field transport**: Swap serial for LoRa/MQTT; add device heartbeat and OTA hooks.
6) **Observability**: Pipe device traces into existing monitor dashboard; expose per-device latency/uptime.

## Open Questions
- Which second MCU families (STM32G4/H7, ESP32-S3) to support next?
- Preferred transport for first pilot (serial vs BLE vs MQTT)?
- Licensing for TinyLLM weights and AGENTOS kernel (MIT/Apache/commercial)?

## Next Steps
- Decide the transport for the bridge prototype.
- Collect target demo list (robot arm, drone, LoRa sensor).
- Wire the new `/api/agentos/*` stubs in `server.js` once transport is chosen.
