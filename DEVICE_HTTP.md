# Device HTTP scheduling

The shared device UI reads ordinary state every 5 seconds after the preceding
read finishes. A1 ring animation and local clocks use the last accepted state
and do not issue network requests. Binding snapshots use a 5-second cadence. TC1 retains its 3-second
ordinary state and 2-second power polling; its extra socket confirmation
experiment is excluded because its hardware regression was incomplete. M1 retains its validated 2-second particle and 4-second
wake-alarm snapshots; the additional auxiliary slowdown failed hardware
regression and was reverted. Explicit refresh, diagnostics, Wi-Fi scans and
OTA progress may read more often.

`command()` owns one queue per page context, including response decoding.
Writes precede queued confirmation reads, which precede background reads.
Overlapping equal reads share one wire request with independent subscriber
cancellation. Retiring a settings route cancels its reads; it never cancels a
write. A new write advances the read generation before entering the queue, so
a later read cannot join a read queued before that write.

After a control is acknowledged, `UI.confirmStatus()` observes actual accepted
status, with at most three extra reads (immediate, then 250 ms and 750 ms after
prior completion). Ordinary polling can confirm slower application work up to
the 12-second deadline. Optimistic UI state is never evidence of confirmation.
Ambiguous write failures only trigger reads; commands are not automatically
resent. If confirmation expires, restore the last confirmed state and surface
the error. `UI.confirm()` remains the separate confirmation-dialog API.

This queue is shared by HTTP and the embedded page's parent transport within
one page context. Independent browser tabs and MQTT clients retain separate
queues. It is not a cross-tab or device-wide rate limiter. Polling is suspended
when hidden and resumes through one full-read chain after cached navigation.

The firmware packer must recognize `DeviceHttpQueue` and skip the older fetch
FIFO adapter for these pages. Older locked frontend releases still use that
adapter. Development images must record both source commits, dirty patches,
served-page SHA-256 and exact firmware SHA-256; source tests alone do not prove
which page is running on hardware.
