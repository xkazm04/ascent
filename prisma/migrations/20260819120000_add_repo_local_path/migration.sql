-- Local mode (self-hosted): pair a Repository with its working copy on the server's filesystem.
-- Nullable, no default — unpaired is the universal starting state, and Ascent Cloud never writes it.
ALTER TABLE IF EXISTS "Repository" ADD COLUMN IF NOT EXISTS "localPath" TEXT;
