-- 2026-10-06: ALREADY RUN on live. DATA only (no DDL, no schema bump).
-- Parvat (route 5) added as member 3 of Local club 'Ghod Dod + Udhana'.
-- Reverses the 2026-10-02 decision 'Parvat stays in Local Other routes'.
-- Also changes Freight Trips Local cards (same getRouteClubs source).

INSERT INTO route_club_members ("clubId", "deliveryTypeId", "routeId", "sortOrder")
SELECT c.id, c."deliveryTypeId", r.id, 3
FROM route_clubs c
JOIN delivery_type_master d ON d.id = c."deliveryTypeId" AND d.name = 'Local'
JOIN route_master r         ON r.name = 'Parvat'
WHERE c.name = 'Ghod Dod + Udhana'
ON CONFLICT ON CONSTRAINT route_club_members_type_route_key DO NOTHING;

-- Result on live: 3 members — 1 Ghod Dod (6) · 2 Udhana (7) · 3 Parvat (5).
