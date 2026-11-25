# Security Specification & Dirty Dozen Audit — Aetheris Hybrid Radio

## 1. Data Invariants
1. **Default-Deny Baseline**: Every unspecified path in Firestore is rejected (`allow read, write: if false`).
2. **PII Isolation**: User `email` is strictly stored in `/users/{userId}/private/info` and never exposed on `/users/{userId}` or `/communityMixes/{mixId}`.
3. **Owner Identity Integrity**: A user can only create, update, or delete `/users/{userId}`, `/users/{userId}/private/{docId}`, or `/users/{userId}/presets/{presetId}` when `request.auth.uid == userId`, `request.auth.token.email_verified == true`, and the document's `uid` matches `request.auth.uid`.
4. **Immutable Ownership & Temporal Integrity**: `uid`, `authorUid`, and `createdAt` cannot be modified on update; `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
5. **Strict Schema & Bounds**: All strings have explicit `.size()` bounds, document IDs match `^[a-zA-Z0-9_\-]+$` (<= 128 chars), and arrays/maps are bounded with zero extra shadow fields (`hasOnly`).
6. **Secure List Queries**: `allow list` rules explicitly enforce `resource.data` predicates (`resource.data.uid == request.auth.uid` for presets, `resource.data.isPublic == true || resource.data.authorUid == request.auth.uid` for community mixes).

## 2. Dirty Dozen Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Preset Write**: `uid: "victim"`, no `request.auth` -> Denied by `isVerified()`.
2. **Unverified Email Spoof**: `request.auth.token.email_verified: false` -> Denied by `isVerified()`.
3. **Cross-Tenant Preset Read/Write**: User A writes to `/users/userB/presets/p1` -> Denied by `isOwner(userId)`.
4. **PII Scraping**: User A reads `/users/userB/private/info` -> Denied by `isOwner(userId)`.
5. **UID Spoofing on Create**: User A creates preset with `uid: "userB"` -> Denied by `data.uid == request.auth.uid`.
6. **Shadow Field Injection**: Payload adds `isAdmin: true` or `role: "super"` -> Denied by `data.keys().hasOnly(...)`.
7. **ID Poisoning**: Document ID contains `/` or 500-char string -> Denied by `isValidId(...)`.
8. **Timestamp Forgery**: Client passes backdated `createdAt` or `updatedAt != request.time` -> Denied by temporal equality check.
9. **Immutable Ownership Tampering**: User updates `authorUid` or `createdAt` on `communityMixes` -> Denied by `incoming().authorUid == existing().authorUid && incoming().createdAt == existing().createdAt`.
10. **Community Mix Overwrite by Non-Author**: User B modifies `title` or `patch` on User A's mix -> Denied by `isMixOwnerAction`.
11. **Like Counter Hijack**: User B jumps `likesCount` from `0` to `9999` -> Denied by `incoming().likesCount == existing().likesCount + 1`.
12. **Blanket List Scraping**: Query on `/users` collection -> Denied (no `list` allowed on `/users`).
