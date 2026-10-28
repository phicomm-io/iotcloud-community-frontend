# Stable OTA path UI

Explain the required 0.9.x -> stable 1.0.0 -> later stable path. RC experiments
remain a separate channel with no stable-path authorization. Clients which do
not report a version are pinned to 1.0.0 by compatibility manifests.

Only `state=available` plus `available=true` exposes install; the click handler
rechecks both, so a hidden/stale button cannot send an install command. Backend
and firmware validate policy independently. This UI does not enforce manual
file or explicit URL OTA policy.

Validation: M1/A1/TC1 dedicated JSDOM UI matrix PASS (normal + minified), checking
notice, available, up_to_date, failure and contradictory flags. Locale table
validation PASS; ordinary full web tests PASS for all three models.
Existing dev WEB_TEST_OTA=1 full test remains blocked at ota.cancel visibility:
expected hidden=true after status refresh, actual=false. Reproduced at unchanged
HEAD source/test before this patch; not caused or repaired by this change. Do not
claim full OTA/browser/device acceptance. No Pages publication or deployment.

Firmware/Worker counterpart: feature/ota-version-policy, commit 94514427 in
phicomm-io/phicomm-community-firmware. Frontend lock publication is separate.
