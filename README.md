# Vitasight

Vitasight is a local workspace for visible posture changes, optical pulse visualization, and human follow-up. Its frontend adapts VITAL's dark observation layout while retaining this project's monitoring, pulse-processing, and review logic.

The primary tabs are **Dashboard**, **Library**, and **Direct Feed**. **Event history** and **Configuration** remain available through utility buttons in the top bar. The dashboard pairs a fluid video area with a 440-pixel patient sidebar on desktop and stacks the panels on smaller screens. Its video-source cards and Library previews are placeholders; added camera and local-video sources use working feed cards.

## Start

Requires **Node.js 24**. From this folder:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:8790**.

Configure SMS in **Configuration > Text alerts**. See [text alert setup](docs/text-alerts.md).
