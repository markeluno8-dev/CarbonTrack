;; CaptureRegistry.clar
;; Core contract for registering carbon capture events in CarbonTrack
;; Handles immutable registration of capture data, prevents duplicates,
;; supports metadata, versioning of reports, collaborator management,
;; status updates, and basic compliance checks.

;; Constants
(define-constant ERR-ALREADY-REGISTERED u100)
(define-constant ERR-UNAUTHORIZED u101)
(define-constant ERR-INVALID-HASH u102)
(define-constant ERR-INVALID-METADATA u103)
(define-constant ERR-INVALID-VOLUME u104)
(define-constant ERR-DUPLICATE-ID u105)
(define-constant ERR-NOT-FOUND u106)
(define-constant ERR-MAX-VERSIONS-REACHED u107)
(define-constant ERR-INVALID-STATUS u108)
(define-constant ERR-METADATA-TOO-LONG u109)
(define-constant ERR-INVALID-METHOD u110)
(define-constant ERR-INVALID-LOCATION u111)
(define-constant MAX-METADATA-LEN u1000)
(define-constant MAX-TAGS u10)
(define-constant MAX-VERSIONS u5)
(define-constant MAX-COLLABORATORS u20)

;; Data Maps
(define-map capture-registry
  { capture-id: uint }  ;; Unique ID for each capture event
  {
    hash: (buff 32),     ;; SHA-256 hash of the capture report
    owner: principal,    ;; Principal who registered the capture
    timestamp: uint,     ;; Block height at registration
    volume: uint,        ;; CO2 captured in tons (scaled by 10^6 for precision)
    method: (string-utf8 50),  ;; Capture method (e.g., "DAC", "CCS")
    location: (string-utf8 100),  ;; Location description
    metadata: (string-utf8 1000)  ;; Additional JSON-like metadata
  }
)

(define-map capture-hashes
  { hash: (buff 32) }
  { capture-id: uint }  ;; For duplicate prevention and quick lookup
)

(define-map capture-versions
  { capture-id: uint, version: uint }
  {
    updated-hash: (buff 32),
    update-notes: (string-utf8 200),
    timestamp: uint
  }
)

(define-map capture-tags
  { capture-id: uint }
  { tags: (list 10 (string-utf8 20)) }  ;; Categorization tags
)

(define-map collaborators
  { capture-id: uint, collaborator: principal }
  {
    role: (string-utf8 50),  ;; e.g., "verifier", "auditor"
    permissions: (list 5 (string-utf8 20)),  ;; e.g., "update", "verify"
    added-at: uint
  }
)

(define-map capture-status
  { capture-id: uint }
  {
    status: (string-utf8 20),  ;; e.g., "pending", "verified", "disputed"
    visibility: bool,          ;; Public or private
    last-updated: uint
  }
)

(define-map next-capture-id uint uint)  ;; Counter for unique IDs
(map-set next-capture-id u0 u1)  ;; Initialize to 1

;; Private Functions
(define-private (is-owner-or-collaborator (capture-id uint) (user principal) (permission (string-utf8 20)))
  (let ((registration (map-get? capture-registry {capture-id: capture-id})))
    (if (is-none registration)
      false
      (let ((entry (unwrap-panic registration)))
        (or
          (is-eq (get owner entry) user)
          (match (map-get? collaborators {capture-id: capture-id, collaborator: user})
            collab
            (is-some (index-of? (get permissions collab) permission))
            false
          )
        )
      )
    )
  )
)

(define-private (generate-unique-id)
  (let ((id (default-to u1 (map-get? next-capture-id u0))))
    (map-set next-capture-id u0 (+ id u1))
    id
  )
)

(define-private (count-versions (capture-id uint))
  (fold count-versions-iter (list u1 u2 u3 u4 u5) {count: u0, capture-id: capture-id})
)

(define-private (count-versions-iter (version uint) (acc {count: uint, capture-id: uint}))
  (if (is-some (map-get? capture-versions {capture-id: (get capture-id acc), version: version}))
    {count: (+ (get count acc) u1), capture-id: (get capture-id acc)}
    acc
  )
)

;; Public Functions
(define-public (register-capture 
  (hash (buff 32)) 
  (volume uint) 
  (method (string-utf8 50)) 
  (location (string-utf8 100)) 
  (metadata (string-utf8 1000)))
  (begin
    (asserts! (> (len hash) u0) (err ERR-INVALID-HASH))
    (asserts! (> volume u0) (err ERR-INVALID-VOLUME))
    (asserts! (> (len method) u0) (err ERR-INVALID-METHOD))
    (asserts! (> (len location) u0) (err ERR-INVALID-LOCATION))
    (asserts! (<= (len metadata) MAX-METADATA-LEN) (err ERR-METADATA-TOO-LONG))
    (match (map-get? capture-hashes {hash: hash})
      existing (err ERR-ALREADY-REGISTERED)
      (let ((capture-id (generate-unique-id)))
        (map-set capture-registry
          {capture-id: capture-id}
          {
            hash: hash,
            owner: tx-sender,
            timestamp: block-height,
            volume: volume,
            method: method,
            location: location,
            metadata: metadata
          }
        )
        (map-set capture-hashes {hash: hash} {capture-id: capture-id})
        (map-set capture-status {capture-id: capture-id}
          {
            status: u"pending",
            visibility: true,
            last-updated: block-height
          }
        )
        (ok capture-id)
      )
    )
  )
)

(define-public (add-version 
  (capture-id uint) 
  (new-hash (buff 32)) 
  (notes (string-utf8 200)))
  (let ((registration (map-get? capture-registry {capture-id: capture-id})))
    (asserts! (is-some registration) (err ERR-NOT-FOUND))
    (asserts! (is-owner-or-collaborator capture-id tx-sender u"update") (err ERR-UNAUTHORIZED))
    (let ((current-versions (get count (count-versions capture-id))))
      (asserts! (< current-versions MAX-VERSIONS) (err ERR-MAX-VERSIONS-REACHED))
      (let ((version (+ current-versions u1)))
        (map-set capture-versions
          {capture-id: capture-id, version: version}
          {
            updated-hash: new-hash,
            update-notes: notes,
            timestamp: block-height
          }
        )
        (ok version)
      )
    )
  )
)

(define-public (add-tags 
  (capture-id uint) 
  (tags (list 10 (string-utf8 20))))
  (begin
    (asserts! (is-owner-or-collaborator capture-id tx-sender u"update") (err ERR-UNAUTHORIZED))
    (asserts! (<= (len tags) MAX-TAGS) (err ERR-INVALID-METADATA))
    (map-set capture-tags {capture-id: capture-id} {tags: tags})
    (ok true)
  )
)

(define-public (add-collaborator 
  (capture-id uint) 
  (collaborator principal) 
  (role (string-utf8 50)) 
  (permissions (list 5 (string-utf8 20))))
  (let ((registration (map-get? capture-registry {capture-id: capture-id})))
    (asserts! (is-some registration) (err ERR-NOT-FOUND))
    (asserts! (is-eq (get owner (unwrap-panic registration)) tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (is-none (map-get? collaborators {capture-id: capture-id, collaborator: collaborator})) (err ERR-ALREADY-REGISTERED))
    (map-set collaborators
      {capture-id: capture-id, collaborator: collaborator}
      {
        role: role,
        permissions: permissions,
        added-at: block-height
      }
    )
    (ok true)
  )
)

(define-public (update-status 
  (capture-id uint) 
  (new-status (string-utf8 20)) 
  (visibility bool))
  (begin
    (asserts! (is-owner-or-collaborator capture-id tx-sender u"update") (err ERR-UNAUTHORIZED))
    (asserts! (or (is-eq new-status u"pending") (is-eq new-status u"verified") (is-eq new-status u"disputed")) (err ERR-INVALID-STATUS))
    (map-set capture-status {capture-id: capture-id}
      {
        status: new-status,
        visibility: visibility,
        last-updated: block-height
      }
    )
    (ok true)
  )
)

;; Read-Only Functions
(define-read-only (get-capture-details (capture-id uint))
  (map-get? capture-registry {capture-id: capture-id})
)

(define-read-only (get-capture-by-hash (hash (buff 32)))
  (match (map-get? capture-hashes {hash: hash})
    entry (get-capture-details (get capture-id entry))
    none
  )
)

(define-read-only (get-version (capture-id uint) (version uint))
  (map-get? capture-versions {capture-id: capture-id, version: version})
)

(define-read-only (get-tags (capture-id uint))
  (map-get? capture-tags {capture-id: capture-id})
)

(define-read-only (get-collaborator (capture-id uint) (collaborator principal))
  (map-get? collaborators {capture-id: capture-id, collaborator: collaborator})
)

(define-read-only (get-status (capture-id uint))
  (map-get? capture-status {capture-id: capture-id})
)

(define-read-only (is-authorized (capture-id uint) (user principal) (permission (string-utf8 20)))
  (is-owner-or-collaborator capture-id user permission)
)

(define-read-only (get-next-id)
  (default-to u1 (map-get? next-capture-id u0))
)