#!/bin/bash
mkdir -p fixed

for epub in *.epub; do
    echo "Checking: $epub"
    output="fixed/$epub"

    if [ -d "$epub" ]; then
        # It's an Apple Books exploded folder — needs repackaging
        echo "  ✗ Apple Books folder format — repackaging..."
        cd "$epub"

        # Remove Apple junk files
        rm -f iTunesMetadata.plist iTunesArtwork "META-INF/com.apple.ibooks.display-options.xml"
        find . -name ".DS_Store" -delete

        # Ensure mimetype is correct
        echo -n "application/epub+zip" > mimetype

        # mimetype must be first and uncompressed (EPUB spec)
        zip -X0 "../$output" mimetype
        # Add everything else compressed
        zip -Xr9D "../$output" * -x mimetype -x "*.DS_Store"

        cd ..
        echo "  → Fixed and saved to: $output"

    elif [ -f "$epub" ]; then
        # It's a zip file — check if it's already valid
        first_file=$(unzip -l "$epub" 2>/dev/null | awk 'NR==4 {print $NF}')
        mime_method=$(unzip -v "$epub" mimetype 2>/dev/null | awk 'NR==4 {print $5}')
        mime_content=$(unzip -p "$epub" mimetype 2>/dev/null)

        if [[ "$first_file" == "mimetype" && "$mime_method" == "Stored" && "$mime_content" == "application/epub+zip" ]]; then
            echo "  ✓ Already valid — copying as-is"
            cp "$epub" "$output"
        else
            echo "  ✗ Corrupt zip structure — repackaging..."
            tmp_dir=$(mktemp -d)
            unzip -q "$epub" -d "$tmp_dir"

            # Remove Apple junk
            rm -f "$tmp_dir/iTunesMetadata.plist" "$tmp_dir/iTunesArtwork"
            find "$tmp_dir" -name ".DS_Store" -delete

            echo -n "application/epub+zip" > "$tmp_dir/mimetype"

            cd "$tmp_dir"
            zip -X0 "$OLDPWD/$output" mimetype
            zip -Xr9D "$OLDPWD/$output" * -x mimetype
            cd "$OLDPWD"

            rm -rf "$tmp_dir"
            echo "  → Fixed and saved to: $output"
        fi
    else
        echo "  ? Skipping $epub (not a file or folder)"
    fi
done

echo ""
echo "Done! All files are in the 'fixed/' folder."
