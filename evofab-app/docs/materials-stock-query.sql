-- All active, verified FGF materials currently in stock, with SDS links.
SELECT
  m.id,
  m.name,
  m.provider,
  m.sds_url,
  SUM(s.quantity) AS quantity,
  s.unit
FROM materials AS m
JOIN material_stock AS s ON s.material_id = m.id
WHERE m.technology = 'FGF'
  AND m.source_status = 'verified'
  AND m.is_active = TRUE
  AND m.sds_url IS NOT NULL
  AND s.status <> 'depleted'
  AND s.quantity > 0
GROUP BY m.id, m.name, m.provider, m.sds_url, s.unit
ORDER BY m.name, s.unit;
