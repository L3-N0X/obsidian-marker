![title-banner](assets/title-banner.png)

[![Maintenance](https://img.shields.io/badge/Maintained-yes-a27ded.svg)](https://GitHub.com/L3-N0X/obsidian-marker/graphs/commit-activity)
[![GitHub issues](https://img.shields.io/github/issues/L3-N0X/obsidian-marker.svg?color=a27ded)](https://github.com/L3-N0X/obsidian-marker/issues)
[![GitHub Release](https://img.shields.io/github/v/release/L3-N0X/obsidian-marker?color=a27ded&link=https%3A%2F%2Fgithub.com%2FL3-N0X%2Fobsidian-marker%2Freleases)](https://github.com/L3-N0X/obsidian-marker/releases)
[![GitHub License](https://img.shields.io/github/license/L3-N0X/obsidian-marker?color=a27ded)](https://github.com/L3-N0X/obsidian-marker/blob/master/LICENSE)
[![Marker API](https://img.shields.io/badge/Marker%20API-Required-a27ded.svg)](https://github.com/adithya-s-k/marker-api)

## 🌟 Introduction

Welcome to this Obsidian PDF to Markdown Converter! This plugin brings the power of advanced PDF conversion directly into your Obsidian vault. By leveraging the capabilities of Marker through a self-hosted API or by using the hosted solution on [datalab.to](https://www.datalab.to/), this plugin offers a seamless way to transform your PDFs into rich, formatted Markdown files, with support for tables, formulas and more!

> [!IMPORTANT]
> This plugin requires a Marker API endpoint, a paid account for datalab or the python api of marker to work. Without an endpoint, the application can't convert anything.

You can find the related repositories here:

- [Marker Project](https://github.com/VikParuchuri/marker) (AI model for PDF conversion + Simple Python API)
- [datalab.to](https://www.datalab.to/) (Hosted API for the Marker AI model, provided by the developer himself)
- [Marker API Docker Container](https://hub.docker.com/r/wirawan/marker-api) (Container for self-hosting, needs Nvidia GPU)
- [Marker API](https://github.com/adithya-s-k/marker-api) (API for self-hosting the conversion service)

## 🚀 Features

- **OCR Capabilities**: Convert scanned PDFs to rich markdown
- **Formula Detection**: Accurately captures and converts mathematical formulas
- **Table Extraction**: Preserves table structures in your Markdown output
- **Image Handling**: Extracts and saves images from your PDFs and includes them in the markdown
- **Batch Processing**: Convert multiple PDFs at once by selecting files with Alt + Click (Note: Processing multiple files may take considerable time depending on their size and complexity)
- **Mobile Compatibility**: Works on both desktop and mobile Obsidian apps
- **Flexible Output**: Choose between full content extraction or specific elements (text/images)

## 🛠 Why This Plugin?

1. **Superior Extraction**: Utilizes the Marker project's advanced AI model for high-quality conversions
2. **Mobile Accessibility**: Unlike many converters, this works seamlessly on mobile devices (when the API is accessible)
3. **Customizable**: Tailor the conversion process to your specific needs
4. **Obsidian Integration**: Converts PDFs directly within your Obsidian environment

## ♥️ Support the Project

If you enjoy this plugin, feel free to star the repository and share it with others!
When you want to support the development, consider buying me a coffee:

<a href="https://www.buymeacoffee.com/l3n0x"><img src="https://img.buymeacoffee.com/button-api/?slug=l3n0x&font_family=Inter&button_colour=FFDD00"></a>

## 📋 Requirements

To use this plugin, you'll need:

1. A working Obsidian installation
2. Access to a Marker API endpoint (self-hosted or paid service or python api)

## 🔧 Setup

1. Install the plugin in your Obsidian vault
2. (Optional) Set up the self-hosted Marker API:

   - Use Docker on a machine with a solid GPU/CPU
   - (Optional) Make the endpoint available to other devices (e.g., using [Tailscale](https://tailscale.com/))
   - Alternatively, host in the cloud or run the Python server when needed
3. Configure your Marker API endpoint in the plugin settings

### Which solution should I use?


| Solution                               | Pros                                                                                                | Cons                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Hosted on datalab.to (recommended)** | No setup required, fast and reliable, supports the developer and is easily accessible from anywhere | Costs a few dollars                                             |
| **Self-Hosted via Docker**             | Full control over the conversion process, no costs for the API                                      | Requires a powerful machine, Setup can be complex for beginners |
| **Self-Hosted via Python**             | Easy to set up, no Docker required                                                                  | Not all features available                                      |

### 🧾 Usage

You can convert PDFs to Markdown in multiple ways:

1. **Single PDF file**: Right-click on a PDF file in the file explorer and select "Convert to MD" from the context menu
2. **Multiple PDF files**: Select multiple PDF files with Alt + Click and right-click to convert them all at once
3. **PDF file in editor**: After opening a PDF file in the editor, click on the three dots in the top right corner and select "Convert to MD"
4. **Use the command palette**: Open the command palette and search for "Convert PDF to MD" (only works if a PDF file is open)

## ⚙️ Settings


| Setting                     | Default          | Description                                                                                                                                                |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API Endpoint**            | 'datalab'        | Select the API endpoint to use, either 'Datalab' 'Selfhosted' for Docker/Marker API or 'Python API'.                                                       |
| **Marker API Endpoint**     | 'localhost:8000' | The endpoint to use for the Marker API. Only shown when 'Selfhosted' is selected as the API endpoint.  |
| **Python API Endpoint**     | 'localhost:8001' | The endpoint to use for the Python API. Only shown when 'Python API' is selected as the API endpoint.                                                   |
| **API Key**                 | -                | Enter your Datalab API key. Option is only shown when 'Datalab' is selected as the API endpoint.                                                           |
| **Languages**               | -                | The languages to use if OCR is needed, separated by commas. Only shown when 'Datalab' is selected as the API endpoint.                                     |
| **Force OCR**               | `false`          | Force OCR (Activate this when auto-detect often fails, make sure to set the correct languages). Only shown when 'Datalab' is selected as the API endpoint. |
| **Paginate**                | `false`          | Add horizontal rules between each page. Only shown when 'Datalab' is selected as the API endpoint.                                                         |
| **New Folder for Each PDF** | `true`           | Create a new folder for each PDF that is converted.                                                                                                        |
| **Move PDF to Folder**      | `false`          | Move the PDF to the folder after conversion. Only shown when 'New Folder for Each PDF' is enabled.                                                         |
| **Create Asset Subfolder**  | `true`           | Create an asset subfolder for images.                                                                                                                      |
| **Extract Content**         | 'all'            | Select the content to extract from the PDF. Options: 'Extract everything', 'Text Only', 'Images Only'.                                                     |
| **Write Metadata**          | `true`           | Write metadata as frontmatter in the Markdown file.                                                                                                        |
| **Delete Original PDF**     | `false`          | Delete the original PDF after conversion.                                                                                                                  |

## 🙏 Acknowledgements

This plugin wouldn't be possible without the incredible work of:

- [Marker Project](https://github.com/VikParuchuri/marker): The AI model powering the conversions
- [Marker API](https://github.com/adithya-s-k/marker-api): The API that enables self-hosting of the conversion service

A huge thank you to these projects for their contributions to the community!

## 🐛 Troubleshooting

If you encounter issues related to the plugin itself, please open an issue in this repository. For problems with the conversion process or API, please refer to the Marker and Marker API repositories.

> [!NOTE]
> When converting multiple files at once, be patient as the process can take a significant amount of time depending on the size and complexity of your PDFs. For very large batches, consider processing them in smaller groups.

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
