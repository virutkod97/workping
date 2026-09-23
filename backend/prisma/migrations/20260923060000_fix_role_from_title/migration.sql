-- Sửa dữ liệu: nhân sự có chức danh Trưởng/Phó trưởng phòng nhưng cấp đang là "Nhân viên"
-- (do form thêm nhân sự để mặc định cấp Nhân viên) → nâng cấp theo chức danh.
UPDATE "User" SET "role" = 'DEPUTY'
WHERE "role" = 'STAFF'
  AND ("title" ILIKE 'phó trưởng phòng%' OR "title" ILIKE 'phó phòng%' OR "title" ILIKE 'phó trưởng ban%'
       OR "title" ILIKE 'Phó trưởng phòng%' OR "title" ILIKE 'PHÓ TRƯỞNG PHÒNG%' OR "title" ILIKE 'Phó phòng%');

UPDATE "User" SET "role" = 'HEAD'
WHERE "role" = 'STAFF'
  AND ("title" ILIKE 'trưởng phòng%' OR "title" ILIKE 'Trưởng phòng%' OR "title" ILIKE 'TRƯỞNG PHÒNG%' OR "title" ILIKE 'trưởng ban%');
