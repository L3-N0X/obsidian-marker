![title-banner](assets/title-banner.png)

[![Maintenance](https://img.shields.io/badge/Maintained-yes-a27ded.svg)](https://GitHub.com/L3-N0X/obsidian-marker/graphs/commit-activity)
[![GitHub issues](https://img.shields.io/github/issues/L3-N0X/obsidian-marker.svg?color=a27ded)](https://github.com/L3-N0X/obsidian-marker/issues)
[![GitHub Release](https://img.shields.io/github/v/release/L3-N0X/obsidian-marker?color=a27ded&link=https%3A%2F%2Fgithub.com%2FL3-N0X%2Fobsidian-marker%2Freleases)](https://github.com/L3-N0X/obsidian-marker/releases)
[![GitHub License](https://img.shields.io/github/license/L3-N0X/obsidian-marker?color=a27ded)](https://github.com/L3-N0X/obsidian-marker/blob/master/LICENSE)
[![Marker API](https://img.shields.io/badge/Marker%20API-Required-a27ded.svg)](https://github.com/adithya-s-k/marker-api)

## 🌟 Introduction

Welcome to the Obsidian PDF to Markdown Converter! This extension brings the power of advanced PDF conversion directly into your Obsidian vault. By leveraging the capabilities of the Marker API, this plugin offers a seamless way to transform your PDFs into rich, formatted Markdown files.

> [!IMPORTANT]
> This extension requires a Marker API endpoint to function. Without an endpoint, the application won't work.

You can find the related repositories here:

- [Marker Project](https://github.com/VikParuchuri/marker) (AI model for PDF conversion)
- [Marker API](https://github.com/adithya-s-k/marker-api) (API for self-hosting the conversion service)

## 🚀 Features

- **OCR Capabilities**: Convert scanned PDFs to searchable text
- **Formula Detection**: Accurately captures and converts mathematical formulas
- **Table Extraction**: Preserves table structures in your Markdown output
- **Image Handling**: Extracts and saves images from your PDFs
- **Mobile Compatibility**: Works on both desktop and mobile Obsidian apps
- **Flexible Output**: Choose between full content extraction or specific elements (text/images)

## 🛠 Why This Extension?

1. **Superior Extraction**: Utilizes the Marker project's advanced AI model for high-quality conversions
2. **Mobile Accessibility**: Unlike many converters, this works seamlessly on mobile devices
3. **Customizable**: Tailor the conversion process to your specific needs
4. **Obsidian Integration**: Converts PDFs directly within your Obsidian environment

## ♥️ Support the Project

If you enjoy this extension, feel free to star the repository and share it with others!
When you want to support the development, consider buying me a coffee:

<a href="https://www.buymeacoffee.com/l3n0x"><img src="https://img.buymeacoffee.com/button-api/?slug=l3n0x&font_family=Inter&button_colour=FFDD00"></a>

## 📋 Requirements

To use this extension, you'll need:

1. An Obsidian vault
2. Access to a Marker API endpoint (self-hosted or paid service)

## 🔧 Setup

1. Install the extension in your Obsidian vault
2. Configure your Marker API endpoint in the plugin settings
3. (Optional) Set up a self-hosted Marker API:

   - Use Docker on a machine with a solid GPU/CPU
   - (Optional) Make the endpoint available to other devices (e.g., using Tailscale)
   - Alternatively, host in the cloud or run the Python server as needed

## ⚙️ Settings

| Setting                | Default            | Description                                               |
| ------------------------ | -------------------- | ----------------------------------------------------------- |
| `markerEndpoint`       | `'localhost:8000'` | The URL of your Marker API endpoint                       |
| `createFolder`         | `true`             | Bundle all output files in a folder                       |
| `movePDFtoFolder`      | `false`            | Move the original PDF to the output folder                |
| `createAssetSubfolder` | `true`             | Create a subfolder for extracted assets (images, etc.)    |
| `extractContent`       | `'all'`            | Options: 'Extract everything', 'Text Only', 'Images Only' |
| `writeMetadata`        | `true`             | Include metadata in the converted Markdown file           |
| `deleteOriginal`       | `false`            | Delete the original PDF after conversion                  |

## 🙏 Acknowledgements

This extension wouldn't be possible without the incredible work of:

- [Marker Project](https://github.com/VikParuchuri/marker): The AI model powering the conversions
- [Marker API](https://github.com/adithya-s-k/marker-api): The API that enables self-hosting of the conversion service

A huge thank you to these projects for their contributions to the community!

## 🐛 Troubleshooting

If you encounter issues related to the extension itself, please open an issue in this repository. For problems with the conversion process or API, please refer to the Marker and Marker API repositories.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/L3-N0X/obsidian-marker/issues).

---

Happy converting! 📚➡️📝

---

<p align="center">
  <a href="https://l3n0x.eu5.org">
    <img src="https://api.star-history.com/svg?repos=l3-n0x/obsidian-marker&type=Date" alt="Star History Chart">
  </a>
</p>
