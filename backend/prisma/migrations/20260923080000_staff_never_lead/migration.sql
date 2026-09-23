-- Người chủ trì mốc chỉ là Trưởng/Phó trưởng phòng. Mốc cũ đang để nhân viên làm chủ trì
-- (do chức năng "giao tiếp" trước đây hoặc Trưởng phòng giao thẳng) được chuyển thành:
--   nhân viên → người thực hiện (giữ nguyên tiến độ),
--   chủ trì   → Phó trưởng phòng đã giao mốc (đã "giao tiếp") — PTP vẫn chịu trách nhiệm;
--               Trưởng phòng giao thẳng thì để trống (Trưởng phòng quản lý với tư cách cấp trên).

INSERT INTO "MilestoneMember" ("milestoneId", "userId", "assignedById", "status", "percent", "completedAt", "outOfGroup", "updatedAt")
SELECT m."id", m."assigneeId", m."assignedById", m."status", m."percent", m."completedAt", m."outOfGroup", NOW()
FROM "Milestone" m
JOIN "User" a ON a."id" = m."assigneeId"
WHERE a."role" = 'STAFF'
ON CONFLICT ("milestoneId", "userId") DO NOTHING;

UPDATE "Milestone" m
SET "assigneeId" = (
      SELECT g."id" FROM "User" g
      WHERE g."id" = m."assignedById" AND g."role" = 'DEPUTY'
    ),
    "outOfGroup" = false
WHERE m."assigneeId" IN (SELECT "id" FROM "User" WHERE "role" = 'STAFF');
