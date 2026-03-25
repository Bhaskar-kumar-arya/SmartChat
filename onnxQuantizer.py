from optimum.onnxruntime import ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from optimum.onnxruntime import ORTModelForFeatureExtraction

model_dir = "./smartChat/src/main/models/bhasha-embed-onnx"

model = ORTModelForFeatureExtraction.from_pretrained(model_dir)
quantizer = ORTQuantizer.from_pretrained(model)

qconfig = AutoQuantizationConfig.avx2(is_static=False)

quantizer.quantize(
    save_dir="./smartChat/src/main/models/bhasha-embed-onnx-quantized",
    quantization_config=qconfig
)

print("Quantization complete!")