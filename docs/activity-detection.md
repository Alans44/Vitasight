# Slump and fall detection

The implementation adapts the head-to-torso slump and rapid head-to-ankle collapse approach in `ompatelmed/ed-physical-ai`, reviewed at upstream commit `beceea97491d2c7ce9d736256cf658a8da558031`. It uses Vitasight's existing local YOLO body landmarks and server-side tracking. No upstream source files or Git history were imported.

The default high-sensitivity setup uses a 0.10 head-to-torso slump threshold and a 0.75-second hold. A head at or below the shoulder line first shows **Potential slump**; holding the configured lowered-head position creates a **Slump detected** review event. Visible ears can substitute for an obscured nose. Seated posture uses knees, then ankles, then a cropped-torso fallback. Hidden wrists do not disable posture detection.

A rapid reduction in normalized head-to-ankle separation can create a **Possible fall** alert immediately. High sensitivity uses a reduction of 0.18 body-box heights within 1.1 seconds and a resulting gap at most 0.35. Balanced mode uses 0.35 within 0.7 seconds and a resulting gap at most 0.25. A near-horizontal body can also trigger after 0.25 seconds in high mode, or 0.75 seconds in balanced mode, without needing an upright baseline. Torso compression toward the hips adds a slump signal. A rapid bounding-box height reduction and downward center shift provide a fall fallback when head or ankle landmarks are unreliable. Ambiguous tracking and observation gaps clear the movement history.

Fall checks run independently of the slump timer. A fall produces a persistent red banner, a red patient card, feed warnings, and a stored description with geometry evidence. Hiding landmarks leaves detection and alerts active. Acknowledgment clears the banner while retaining the review record. Detection flags remain visible after recovery. Repeated frames preserve one review event per episode, and a clear recovery allows a later fall episode.

These are sensitive visual geometry rules, not a validated clinical fall classifier. Ordinary bending or lying down may trigger an alert. Source origin, unknown identity, and human review remain explicit. Pulse readings never drive fall or slump alerts.

Use **Start demo → Scenario → Slump**, **Deep slump**, or **Fall / collapse** to exercise the detector with generated poses. Text messaging is shelved.
