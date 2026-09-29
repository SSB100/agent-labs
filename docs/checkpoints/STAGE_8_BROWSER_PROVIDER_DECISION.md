# Stage 8 browser provider decision

This document is created on the Stage 8 branch and will be completed during qualification.

The implementation plan requires Browserbase and Steel to remain replaceable behind one Core browser abstraction. The provisional default is Steel because its managed service supports live WebRTC embeds, human interaction, session replay, persistent profiles, Playwright over CDP, usage-based pricing, and an open-source self-hosting path. Browserbase remains a first-class alternative adapter.

Stage 9 Browser Planner work is explicitly out of scope.
