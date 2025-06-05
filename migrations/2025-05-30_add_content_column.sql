-- Add content column to insurance_qa table for full-text vector search
ALTER TABLE insurance_qa
ADD COLUMN IF NOT EXISTS content TEXT;

-- Populate content column with concatenated question and answer
UPDATE insurance_qa
SET content = CONCAT(
    'שאלה: ', COALESCE(question, ''), 
    E'\n', 
    'תשובה: ', COALESCE(answer, '')
)
WHERE content IS NULL OR content = '';

-- Create index on content column for better performance
CREATE INDEX IF NOT EXISTS idx_insurance_qa_content 
ON insurance_qa USING gin(to_tsvector('hebrew', content));

-- Verify the column was added correctly
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'insurance_qa' 
        AND column_name = 'content'
    ) THEN
        RAISE EXCEPTION 'Content column not properly added to insurance_qa table';
    END IF;
END $$; 