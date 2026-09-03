#!/bin/bash
# นับจำนวนสินค้าในแต่ละหน้า tag — ใช้ตรวจซ้ำหลังตัด tag แล้ว
# ใช้: bash tools/crawl-site.sh
set -e
B="https://www.xn--q3ca6cja3bzj.com"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
OUT="${1:-crawl-out}"
mkdir -p "$OUT/tag"

curl -sS --max-time 25 "$B/general/sitemap.xml" \
  | grep -oE '<loc>[^<]*</loc>' | sed 's|</\?loc>||g' \
  | grep '/product/tag/' | sort -u > "$OUT/tag-urls.txt"
echo "พบหน้า tag: $(wc -l < "$OUT/tag-urls.txt")"

: > "$OUT/tag-counts.txt"
while read -r u; do
  n=$(curl -sS --max-time 25 -A "$UA" "$u" | grep -oE '/product/[0-9]+/' | sort -u | wc -l)
  printf '%3d  %s\n' "$n" "$(python3 -c 'import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1].rsplit("/",1)[-1]))' "$u")" >> "$OUT/tag-counts.txt"
done < "$OUT/tag-urls.txt"

sort -rn "$OUT/tag-counts.txt" -o "$OUT/tag-counts.txt"
echo "--- tag ที่มีสินค้า <= 2 ชิ้น (ควรตัด) ---"
awk '$1<=2' "$OUT/tag-counts.txt" | wc -l
cat "$OUT/tag-counts.txt"
