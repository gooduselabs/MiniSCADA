#!/bin/sh
# mat-updater-recover (feature 011 T114; contracts/update-package.md §4): at boot, before
# mat-runtime.service, finishes or undoes an update cut by a power loss or a kill. The logic lives
# in mat-updater (--recover) so both share one implementation of the steps.
exec /bin/sh "$(dirname "$0")/mat-updater" --recover "$@"
