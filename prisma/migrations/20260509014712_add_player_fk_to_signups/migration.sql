/*
  Warnings:

  - You are about to drop the column `name` on the `signups` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `signups` table. All the data in the column will be lost.
  - Added the required column `player_id` to the `signups` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "signups" DROP COLUMN "name",
DROP COLUMN "phone",
ADD COLUMN     "player_id" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "signups" ADD CONSTRAINT "signups_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
