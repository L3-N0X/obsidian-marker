![title-banner](assets/title-banner.png)

[![Maintenance](https://img.shields.io/badge/Maintained-yes-a27ded.svg)](https://GitHub.com/L3-N0X/obsidian-marker/graphs/commit-activity)
[![GitHub issues](https://img.shields.io/github/issues/L3-N0X/obsidian-marker.svg?color=a27ded)](https://github.com/L3-N0X/obsidian-marker/issues)
[![GitHub Release](https://img.shields.io/github/v/release/L3-N0X/obsidian-marker?color=a27ded&link=https%3A%2F%2Fgithub.com%2FL3-N0X%2Fobsidian-marker%2Freleases)](https://github.com/L3-N0X/obsidian-marker/releases)
[![GitHub License](https://img.shields.io/github/license/L3-N0X/obsidian-marker?color=a27ded)](https://github.com/L3-N0X/obsidian-marker/blob/master/LICENSE)

## 🌟 Introduction

Welcome to this Obsidian PDF to Markdown Converter! This plugin brings the power of advanced PDF conversion directly into your Obsidian vault. By leveraging the capabilities of Marker through a self-hosted API, the hosted solution on [datalab.to](https://www.datalab.to/), or the powerful MistralAI OCR capabilities, this plugin offers a seamless way to transform your PDFs into rich, formatted Markdown files, with support for tables, formulas and more!

> [!IMPORTANT]
> This plugin requires a Marker API endpoint, a paid account for datalab, the python api of marker, or a free MistralAI API key to work. Without an endpoint, the application can't convert anything.

You can find the related repositories and services here:

- [Marker Project](https://github.com/VikParuchuri/marker) (AI model for PDF conversion + Simple Python API)
- [datalab.to](https://www.datalab.to/) (Hosted API for the Marker AI model, provided by the developer himself)
- [Marker API Docker Container](https://hub.docker.com/r/wirawan/marker-api) (Container for self-hosting, needs Nvidia GPU)
- [Marker API](https://github.com/adithya-s-k/marker-api) (API for self-hosting the conversion service)
- [MistralAI](https://console.mistral.ai/) (Free OCR API with excellent results)

## 🚀 Features

- **OCR Capabilities**: Convert scanned PDFs to rich markdown
- **Formula Detection**: Accurately captures and converts mathematical formulas
- **Table Extraction**: Preserves table structures in your Markdown output
- **Image Handling**: Extracts and saves images from your PDFs and includes them in the markdown
- **Batch Processing**: Convert multiple PDFs at once by selecting files with Alt + Click (Note: Processing multiple files may take considerable time depending on their size and complexity)
- **Mobile Compatibility**: Works on both desktop and mobile Obsidian apps
- **Flexible Output**: Choose between full content extraction or specific elements (text/images)
- **Smart Folder Integration**: If a folder with the PDF's name already exists, the plugin will ask if you want to integrate the new files into the existing folder

## 🛠 Why This Plugin?

1. **Superior Extraction**: Utilizes the Marker project's advanced AI model or MistralAI's powerful OCR for high-quality conversions
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
2. Access to a Marker API endpoint (self-hosted or paid service or python api) OR a free MistralAI API key

## 🔧 Setup

1. Install the plugin in your Obsidian vault
2. Choose your conversion method:
   - **MistralAI**: Get a free API key from [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)
   - **Datalab.to**: Sign up for a paid account
   - **Self-hosted Marker API**: Set up Docker on a machine with a solid GPU/CPU
   - **Python API**: Run the Python server when needed
3. Configure your chosen endpoint/API key in the plugin settings

### Which solution should I use?


| Solution                               | Pros                                                                                                | Cons                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **MistralAI (recommended)** | Completely free, excellent results in testing, easy setup with just an API key | Uploads your files to Mistral's servers (stored for at least 24h) |
| **Hosted on datalab.to** | No setup required, fast and reliable, supports the developer and is easily accessible from anywhere | Costs a few dollars                                             |
| **Self-Hosted via Docker**             | Full control over the conversion process, no costs for the API                                      | Requires a powerful machine, Setup can be complex for beginners |
| **Self-Hosted via Python**             | Easy to set up, no Docker required                                                                  | Not all features available                                      |

> [!NOTE]
> **MistralAI Privacy Consideration**: When using the MistralAI endpoint, your PDFs will be uploaded to Mistral's servers for processing. These files are stored for at least 24 hours. If you have sensitive documents, consider using a self-hosted solution instead.

### 🧾 Usage

You can convert PDFs to Markdown in multiple ways:

1. **Single PDF file**: Right-click on a PDF file in the file explorer and select "Convert to MD" from the context menu
2. **Multiple PDF files**: Select multiple PDF files with Alt + Click and right-click to convert them all at once
3. **PDF file in editor**: After opening a PDF file in the editor, click on the three dots in the top right corner and select "Convert to MD"
4. **Use the command palette**: Open the command palette and search for "Convert PDF to MD" (only works if a PDF file is open)

**Folder Integration**: If a folder with the same name as your PDF already exists, the plugin will ask if you want to integrate the new files into this existing folder. This allows you to update or add to already converted documents.

## ⚙️ Settings


| Setting                     | Default          | Description                                                                                                                                                |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API Endpoint**            | 'selfhosted'        | Select the API endpoint to use: 'Datalab', 'Selfhosted', 'Python API', or 'MistralAI'                                                      |
| **Marker API Endpoint**     | 'localhost:8000' | The endpoint to use for the Marker API. Only shown when 'Selfhosted' is selected as the API endpoint.  |
| **Python API Endpoint**     | 'localhost:8001' | The endpoint to use for the Python API. Only shown when 'Python API' is selected as the API endpoint.                                                   |
| **Datalab API Key**          | -                | Enter your Datalab API key. Only shown when 'Datalab' is selected as the API endpoint.                                                           |
| **MistralAI API Key**       | -                | Enter your MistralAI API key. Only shown when 'MistralAI' is selected as the API endpoint.                                                     |
| **Languages**               | 'en'             | The languages to use if OCR is needed, separated by commas. Only shown when 'Datalab' is selected as the API endpoint.                                     |
| **Force OCR**               | `false`          | Force OCR (Activate this when auto-detect often fails, make sure to set the correct languages). Only shown when 'Datalab' is selected as the API endpoint. |
| **Paginate**                | `false`          | Add horizontal rules between each page. Available for both Datalab and MistralAI endpoints.                                                         |
| **Image Limit**             | `0`              | Maximum number of images to extract (0 for no limit). Only shown when 'MistralAI' is selected.                                                  |
| **Image Minimum Size**      | `0`              | Minimum height and width of images to extract (0 for no minimum). Only shown when 'MistralAI' is selected.                                     |
| **Move PDF to Folder**      | `false`          | Move the PDF to the folder after conversion.                                                        |
| **Create Asset Subfolder**  | `true`           | Create an asset subfolder for images.                                                                                                                      |
| **Extract Content**         | 'all'            | Select the content to extract from the PDF. Options: 'Extract everything', 'Text Only', 'Images Only'.                                                     |
| **Write Metadata**          | `false`          | Write metadata as frontmatter in the Markdown file.                                                                                                        |
| **Delete Original PDF**     | `false`          | Delete the original PDF after conversion.                                                                                                                  |

## 🙏 Acknowledgements

This plugin wouldn't be possible without the incredible work of:

- [Marker Project](https://github.com/VikParuchuri/marker): The AI model powering the conversions
- [Marker API](https://github.com/adithya-s-k/marker-api): The API that enables self-hosting of the conversion service
- [MistralAI](https://mistral.ai/): For providing the free OCR capabilities

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
