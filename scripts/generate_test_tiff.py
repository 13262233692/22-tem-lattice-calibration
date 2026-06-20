import numpy as np
from PIL import Image
import os
import math

def generate_lattice_pattern(width, height, spacing=20, angle=0, noise_level=500):
    x = np.arange(width)
    y = np.arange(height)
    xx, yy = np.meshgrid(x, y)
    
    angle_rad = math.radians(angle)
    x_rot = xx * math.cos(angle_rad) - yy * math.sin(angle_rad)
    y_rot = xx * math.sin(angle_rad) + yy * math.cos(angle_rad)
    
    pattern = (np.sin(2 * math.pi * x_rot / spacing) + 1) / 2 * 0.5
    pattern += (np.sin(2 * math.pi * y_rot / spacing) + 1) / 2 * 0.5
    
    pattern2 = (np.sin(2 * math.pi * (x_rot + y_rot) / (spacing * math.sqrt(2))) + 1) / 2 * 0.3
    pattern += pattern2
    
    noise = np.random.normal(0, noise_level / 65535, pattern.shape)
    pattern += noise
    
    pattern = np.clip(pattern, 0, 1)
    
    image_16bit = (pattern * 65535).astype(np.uint16)
    
    return image_16bit

def generate_defects(image, num_defects=20):
    height, width = image.shape
    for _ in range(num_defects):
        x = np.random.randint(0, width)
        y = np.random.randint(0, height)
        radius = np.random.randint(5, 20)
        
        yy, xx = np.ogrid[:height, :width]
        mask = (xx - x)**2 + (yy - y)**2 <= radius**2
        
        image[mask] = np.random.randint(0, 65535, size=mask.sum()).astype(np.uint16)
    
    return image

def generate_grain_boundaries(image, num_boundaries=5):
    height, width = image.shape
    for _ in range(num_boundaries):
        x1, y1 = np.random.randint(0, width), np.random.randint(0, height)
        x2, y2 = np.random.randint(0, width), np.random.randint(0, height)
        
        thickness = np.random.randint(2, 6)
        
        for t in np.linspace(0, 1, max(width, height) * 2):
            x = int(x1 + t * (x2 - x1))
            y = int(y1 + t * (y2 - y1))
            
            for dy in range(-thickness, thickness + 1):
                for dx in range(-thickness, thickness + 1):
                    if 0 <= y + dy < height and 0 <= x + dx < width:
                        if dx*dx + dy*dy <= thickness*thickness:
                            image[y + dy, x + dx] = np.random.randint(0, 10000)
    
    return image

def save_tiff(image, filename):
    img = Image.fromarray(image, mode='I;16')
    img.save(filename, compression='tiff_lzw')
    print(f"Saved {filename} - {image.shape[1]}x{image.shape[0]} 16-bit TIFF")

def main():
    output_dir = 'test_images'
    os.makedirs(output_dir, exist_ok=True)
    
    test_cases = [
        {'name': 'test_2k_lattice', 'width': 2048, 'height': 2048, 'spacing': 25, 'angle': 0},
        {'name': 'test_4k_lattice', 'width': 4096, 'height': 4096, 'spacing': 30, 'angle': 15},
        {'name': 'test_8k_lattice', 'width': 8192, 'height': 8192, 'spacing': 40, 'angle': 30},
        {'name': 'test_8k_large_spacing', 'width': 8192, 'height': 8192, 'spacing': 100, 'angle': 45},
        {'name': 'test_ultra_8k', 'width': 8192, 'height': 8192, 'spacing': 15, 'angle': 0},
    ]
    
    for case in test_cases:
        print(f"Generating {case['name']}...")
        image = generate_lattice_pattern(
            case['width'], 
            case['height'], 
            spacing=case['spacing'], 
            angle=case['angle'],
            noise_level=800
        )
        
        if '8k' in case['name']:
            image = generate_defects(image, num_defects=50)
            image = generate_grain_boundaries(image, num_boundaries=8)
        
        filename = os.path.join(output_dir, f"{case['name']}.tif")
        save_tiff(image, filename)
        
        file_size = os.path.getsize(filename) / (1024 * 1024)
        print(f"  File size: {file_size:.2f} MB")

if __name__ == '__main__':
    main()
