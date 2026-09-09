# Prepare resource removal

An Admin can select active application Queues and Durable Object namespaces in Project resource settings and prepare a removal Workspace. The review records the Accepted commit, successful production deployment, operation, provider IDs, and generations. Workspace creation rechecks them. Changes to source, deployment, resource identity, or recovery records require a new review.

Use two Checkpoints. First remove references while retaining the historical Alchemy resource declaration. After deployment, verification, and reviewed retirement/removal, remove that declaration in the second Checkpoint. A Workspace prompt does not authorize deployment or bypass resource checks.

## Queues

Consumer deletion requires an owned Queue and Worker consumer. The broker must confirm absence through a successful provider collection after deletion. Remove producer bindings before requesting retirement.

The starter supports consumer detachment only through `scripts/managed-queue-consumers.json`. It requires an empty pending journal and disables the managed producer, but retains the physical binding and recovery configuration. The retained binding blocks retirement. Full removal requires another reviewed source change.

## Durable Objects

Class removal needs a `retirement` descriptor on the historical plan entry with the exact `resourceId` and `generation`. The migration cannot recreate the class or retain a binding to it. This permission applies only to production. It requires verified provider identity and no saved recovery point containing the namespace.

After deployment, capture and retirement require a successful namespace collection showing that the original ID is absent. A failed request or a 404 alone is insufficient.

Deleting a namespace permanently deletes its data; a snapshot cannot recreate its ID. Any saved recovery point containing it blocks deletion. Normal release capture can add such a point even if none existed when the Workspace was prepared. That release can remove references, but cannot delete the namespace through the managed recovery process. Saved recovery points are never deleted implicitly.

After the release passes its checks and the provider confirms detachment or permitted class removal, use the reviewed retirement and removal actions. Then save the second Checkpoint without the historical declaration.
