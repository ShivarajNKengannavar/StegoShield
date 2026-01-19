# Text stego — zero width mapping (low capacity)
ZW_MAP = {
    '00': '',
    '01': '\u200B',
    '10': '\u200C',
    '11': '\u200D'
}
INV_ZW = {v:k for k,v in ZW_MAP.items()}

def _bytes_to_bits(data: bytes):
    bits=[]
    for b in data:
        for i in range(8):
            bits.append((b >> (7-i)) & 1)
    return bits

def _bits_to_bytes(bits):
    out = bytearray()
    for i in range(0, len(bits), 8):
        byte=0
        for j in range(8):
            if i+j < len(bits):
                byte = (byte << 1) | bits[i+j]
            else:
                byte = (byte << 1)
        out.append(byte & 0xFF)
    return bytes(out)

def find_insertion_points(text):
    pts=[]
    for i,ch in enumerate(text[:-1]):
        if ch.isspace() or ch in ',.;:!?':
            pts.append(i+1)
    return pts

def embed(cover_text_path, enc_payload_bytes, aes_key_bytes, rsa_pub_bytes, out_path):
    text = open(cover_text_path,'r',encoding='utf-8').read()
    pts = find_insertion_points(text)
    bits = _bytes_to_bits(enc_payload_bytes)
    cap = len(pts) * 2
    if len(bits) > cap:
        raise RuntimeError("text cover capacity too small")
    out=[]
    last=0; bit_idx=0
    for pos in pts:
        out.append(text[last:pos])
        b1 = str(bits[bit_idx]) if bit_idx < len(bits) else '0'; bit_idx += 1
        b2 = str(bits[bit_idx]) if bit_idx < len(bits) else '0'; bit_idx += 1
        out.append(ZW_MAP[b1+b2])
        last = pos
        if bit_idx >= len(bits):
            break
    out.append(text[last:])
    open(out_path,'w',encoding='utf-8').write(''.join(out))
    return out_path

def extract(stego_text_path, rsa_priv_bytes, out_enc_path):
    text = open(stego_text_path,'r',encoding='utf-8').read()
    bits=[]
    for ch in text:
        if ch in INV_ZW:
            k = INV_ZW[ch]
            bits.extend([int(k[0]), int(k[1])])
    enc_bytes = _bits_to_bytes(bits)
    open(out_enc_path,'wb').write(enc_bytes)
    return out_enc_path
