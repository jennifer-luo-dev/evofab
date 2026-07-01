# Hardware tests

Hardware tests are intentionally excluded from `npm test` and `npm run check`.
Add supervised printer checks here only after recording the printer, firmware,
fixture, expected motion/temperature, operator, and emergency-stop procedure.

Run through `npm run test:hardware`; the runner refuses to start without both
`RUN_HARDWARE_TESTS=true` and the required hardware confirmation value.
