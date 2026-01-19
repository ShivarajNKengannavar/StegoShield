# reset.py — Clean reset for SecureStego backend
import os
import shutil

BASE = os.path.dirname(__file__)
DIRS = {
    "uploads": os.path.join(BASE, "uploads"),
    "tmp": os.path.join(BASE, "tmp"),
    "outputs": os.path.join(BASE, "outputs"),
}

# These files MUST NOT be deleted
SAFE_OUTPUT_KEEP = {
    "rsa_private.pem",
    "rsa_public.pem"
}

def clean_dir(path, keep=None):
    keep = keep or set()
    if not os.path.exists(path):
        os.makedirs(path)
        return

    for item in os.listdir(path):
        full_path = os.path.join(path, item)

        # don't delete protected key files
        if os.path.basename(full_path) in keep:
            continue

        try:
            if os.path.isfile(full_path):
                os.remove(full_path)
            elif os.path.isdir(full_path):
                shutil.rmtree(full_path)
        except Exception as e:
            print(f"Failed to delete {full_path}: {e}")

def main():
    print("🔄 Resetting SecureStego workspace...\n")

    # Clean folders
    print("🗂 Cleaning uploads/")
    clean_dir(DIRS["uploads"])

    print("🗂 Cleaning tmp/")
    clean_dir(DIRS["tmp"])

    print("🗂 Cleaning outputs/ (keeping RSA keys)")
    clean_dir(DIRS["outputs"], keep=SAFE_OUTPUT_KEEP)

    print("\n✅ Reset complete! Fresh workspace ready.")

if __name__ == "__main__":
    main()
