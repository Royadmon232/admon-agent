-- מוסיף עמודה jsonb ריקה כברירת מחדל.
ALTER TABLE insurance_qa
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- מאכלס את העמודה במבנה מוסכם (id, category, question, answer, complexity).
UPDATE insurance_qa
SET    metadata = jsonb_build_object(
          'id',        id,
          'category',  category,
          'question',  question,
          'answer',    answer,
          'complexity',complexity
       )
WHERE  metadata = '{}'::jsonb; 