# loop-ssr-draft (lever L3: server-rendered first frame behind ?ssr=1)

Started 13:46 UTC 2026-11-17 on work/loop-base a0dbd90. Deadline: stop new work 15:56, end 16:16.

## Mechanism metric and prediction (written before any product change)
Metric: time from navigation start to the first frame that shows real engine data (a seated model's name visible,
effective opacity > 0.5, on the phone table), Pixel-class phone profile (412x915, DPR 2.625, touch, mobile UA, no
automation flags beyond puppeteer's), applied 4x CPU throttling, fresh browser context per run, ?ssr=1 against the
base page (no flag), >= 20 interleaved paired runs, median paired difference with a bootstrap 95% interval.

Prediction: the base paints its first real data only after the JS has loaded, React has hydrated and the stream's first
snapshot is applied (about 1.5-2.5 s at 4x on this VM with no network throttling). With ?ssr=1 the data is in the HTML,
so it paints at first paint (about 0.3-0.7 s). Predicted gain: at least 1.0 s faster (median paired difference),
minus a server-side cost of a few tens of ms on a cache miss (the engine fetch).

## Status
(in progress)
