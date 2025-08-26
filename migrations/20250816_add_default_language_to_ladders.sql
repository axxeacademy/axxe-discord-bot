-- Migration: Add default_language column to ladders table

ALTER TABLE ladders
ADD COLUMN default_language VARCHAR(10) NOT NULL DEFAULT 'pt-PT';
