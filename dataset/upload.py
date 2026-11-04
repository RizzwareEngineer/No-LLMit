"""Push an export directory to a Hugging Face dataset repo.

  python upload.py --out out --pull        # before export: fetch the published hands/seats tables
  python upload.py --out out               # upload; needs HF_TOKEN and HF_REPO (e.g. user/no-llmit-hands)
  python upload.py --out out --dry-run     # list what would upload, no network

--pull lets a one-day export build a card (lineup, prompt versions) that covers every day.
"""

import argparse
import os
import sys
from pathlib import Path


def files_to_upload(out):
    paths = (p.relative_to(out) for p in Path(out).rglob("*") if p.is_file())
    return sorted(str(p) for p in paths if p.parts[0] != ".cache")  # .cache is snapshot_download's


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--pull", action="store_true", help="download published hands/seats Parquet into --out")
    args = ap.parse_args(argv)
    token, repo = os.environ.get("HF_TOKEN"), os.environ.get("HF_REPO")

    if args.dry_run:
        files = files_to_upload(args.out)
        size = sum(os.path.getsize(os.path.join(args.out, f)) for f in files)
        print(f"Would upload {len(files)} files ({size / 1e6:.1f} MB) to {repo or '<HF_REPO unset>'}:")
        print("\n".join(f"  {f}" for f in files))
        return
    if not token or not repo:
        sys.exit("Set HF_TOKEN and HF_REPO, or pass --dry-run.")

    from huggingface_hub import HfApi, snapshot_download

    api = HfApi(token=token)
    api.create_repo(repo, repo_type="dataset", exist_ok=True)
    if args.pull:
        snapshot_download(repo, repo_type="dataset", token=token, local_dir=args.out,
                          allow_patterns=["day=*/hands.parquet", "day=*/seats.parquet", "system_prompts.jsonl"])
        return
    api.upload_folder(repo_id=repo, repo_type="dataset", folder_path=args.out,
                      commit_message=f"Export {', '.join(sorted(p.name for p in Path(args.out).glob('day=*')))}",
                      ignore_patterns=[".cache/**"])
    print(f"Uploaded {args.out} to https://huggingface.co/datasets/{repo}")


if __name__ == "__main__":
    main()
