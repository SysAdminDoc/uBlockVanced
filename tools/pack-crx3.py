#!/usr/bin/env python3
"""
Pack a Chrome extension directory into CRX3 format.
Generates a new RSA key (or reuses existing .pem) and creates a valid CRX3 binary.
"""
import os, sys, struct, hashlib, zipfile, io

from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.backends import default_backend

# ---------- args ----------
src_dir  = sys.argv[1]  # e.g. dist/build/uBlock0.chromium
zip_path = sys.argv[2]  # e.g. dist/build/uBlockVanced.zip
crx_path = sys.argv[3]  # e.g. dist/build/uBlockVanced.crx
pem_path = sys.argv[4] if len(sys.argv) > 4 else "uBlockVanced.pem"

# ---------- key ----------
if os.path.exists(pem_path):
    print(f"Reusing key: {pem_path}")
    with open(pem_path, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())
else:
    print(f"Generating new RSA-2048 key -> {pem_path}")
    private_key = rsa.generate_private_key(
        public_exponent=65537, key_size=2048, backend=default_backend()
    )
    with open(pem_path, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))
    print(f"Key saved to {pem_path} — keep this file to preserve extension ID!")

# ---------- build ZIP ----------
print(f"Building ZIP: {zip_path}")
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src_dir):
        # Skip hidden dirs
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fname in files:
            fpath = os.path.join(root, fname)
            arcname = os.path.relpath(fpath, src_dir).replace("\\", "/")
            zf.write(fpath, arcname)
zip_bytes = buf.getvalue()

os.makedirs(os.path.dirname(zip_path), exist_ok=True)
with open(zip_path, "wb") as f:
    f.write(zip_bytes)
print(f"  ZIP size: {len(zip_bytes):,} bytes")

# ---------- build CRX3 header ----------
pub_key = private_key.public_key()
pub_der  = pub_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

# crx_id = first 16 bytes of SHA-256 of DER public key
crx_id = hashlib.sha256(pub_der).digest()[:16]

# SignedData protobuf: field 1 (crx_id) = bytes
def encode_varint(n):
    parts = []
    while n > 0x7F:
        parts.append((n & 0x7F) | 0x80)
        n >>= 7
    parts.append(n)
    return bytes(parts)

def encode_bytes_field(field_num, data):
    tag = encode_varint(field_num << 3 | 2)
    return tag + encode_varint(len(data)) + data

signed_data_proto = encode_bytes_field(1, crx_id)

# Payload to sign = magic prefix + LE32(len(signed_data)) + signed_data + zip
signed_payload = (
    b"CRX3 SignedData\x00"
    + struct.pack("<I", len(signed_data_proto))
    + signed_data_proto
    + zip_bytes
)

signature = private_key.sign(signed_payload, padding.PKCS1v15(), hashes.SHA256())

# AsymmetricKeyProof: field 1 = pubkey bytes, field 2 = signature bytes
key_proof_proto = (
    encode_bytes_field(1, pub_der) +
    encode_bytes_field(2, signature)
)

# CrxFileHeader: field 2 = AsymmetricKeyProof, field 10000 = SignedData
# field 10000 tag = varint(10000 << 3 | 2) = 0x82 0xF1 0x04
field_10000_tag = b"\x82\xf1\x04"
crx_header_proto = (
    encode_bytes_field(2, key_proof_proto) +
    field_10000_tag + encode_varint(len(signed_data_proto)) + signed_data_proto
)

# CRX3 binary: magic + version(3) + header_size + header + zip
crx_magic = b"Cr24"
crx_version = struct.pack("<I", 3)
header_size = struct.pack("<I", len(crx_header_proto))

crx_bytes = crx_magic + crx_version + header_size + crx_header_proto + zip_bytes

os.makedirs(os.path.dirname(crx_path), exist_ok=True)
with open(crx_path, "wb") as f:
    f.write(crx_bytes)

print(f"  CRX size: {len(crx_bytes):,} bytes")
print(f"  Extension ID: {''.join(chr(ord('a') + (b & 0x0f)) + chr(ord('a') + (b >> 4)) for b in crx_id)}")
print(f"CRX3 written: {crx_path}")
# Verify magic
with open(crx_path, "rb") as f:
    assert f.read(4) == b"Cr24", "Bad magic"
    ver = struct.unpack("<I", f.read(4))[0]
    assert ver == 3, f"Bad version: {ver}"
print("CRX3 header verified OK")
