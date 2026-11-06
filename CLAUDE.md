# Memori projek

Ingatan projek ni ada dalam fail bawah. Ia dimuatkan setiap kali sesi baru buka repo ni.

@.claude/memory/MEMORY.md

## Cara jaga memori (claude-mem versi ringan)

- Baca memori dulu sebelum mula kerja. Jangan suruh user terang balik benda yang dah tercatat.
- User cakap "ingat ni", "simpan dalam memori", "lain kali buat macam ni", atau dia betulkan benda sama dua kali: tambah satu baris dalam `.claude/memory/MEMORY.md` bawah tajuk yang kena.
- User cakap "lupa ..." atau fakta dah berubah: buang atau betulkan baris tu.
- User taip "memori": senaraikan ringkas apa yang tersimpan.
- Satu baris satu fakta, mula dengan tarikh (YYYY-MM-DD). Kalau dah ada yang sama, gabung. Lebih 150 baris, ringkaskan yang lama.
- Jangan simpan data client: nama, IC, telefon, nombor polisi, kesihatan, kewangan. Tulis sebagai prinsip umum je.
- Lepas ubah memori, commit dan push ke branch kerja semasa. Sesi baru hanya nampak memori tu lepas branch di-merge ke `main`.
- Skill task-observer: simpan pemerhatian bawah "Pemerhatian skill" dalam fail memori yang sama, supaya tak hilang bila sesi tutup. Edit skill hanya lepas user setuju.
