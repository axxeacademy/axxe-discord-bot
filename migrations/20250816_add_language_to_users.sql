-- Migration to add 'language' column to 'users' table
ALTER TABLE users
ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT 'pt-PT';
