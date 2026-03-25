from transformers import AutoTokenizer
from optimum.onnxruntime import ORTModelForFeatureExtraction

model_id = "AkshitaS/bhasha-embed-v0"
output_dir = "./smartChat/src/main/models/bhasha-embed-onnx"

# Download tokenizer
tokenizer = AutoTokenizer.from_pretrained(model_id)

# Export model to ONNX automatically
model = ORTModelForFeatureExtraction.from_pretrained(
    model_id,
    export=True
)

# Save ONNX model + tokenizer
model.save_pretrained(output_dir)
tokenizer.save_pretrained(output_dir)

print("ONNX export completed!")