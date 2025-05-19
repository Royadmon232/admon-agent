import json

# Read the input file
with open('insurance_knowledge.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Remove embedding field from each Q&A pair
for qa in data:
    if 'embedding' in qa:
        del qa['embedding']

# Write the modified data back to the file
with open('insurance_knowledge.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2) 