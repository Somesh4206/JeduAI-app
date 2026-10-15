import UIKit
import WebKit
import UniformTypeIdentifiers

/// JeduAI iOS client — a thin, native shell around the JeduAI web app.
/// The server URL is baked in at build time: the app connects straight
/// away on first launch and never asks the user for an address.
final class ViewController: UIViewController {

    /// Build-time server (official published build). To make a self-hosted
    /// variant, change this constant and re-build.
    private static let serverURL = URL(string: "https://jeduai-app.space-z.ai")!
    private static var serverHost: String { serverURL.host?.lowercased() ?? "" }

    /// Brand color #5b5fef / #773de8 (matches the web app's j-grad-primary).
    static let brandStart = UIColor(red: 0.357, green: 0.373, blue: 0.937, alpha: 1)
    static let brandEnd = UIColor(red: 0.467, green: 0.239, blue: 0.910, alpha: 1)

    // MARK: - UI

    private var webView: WKWebView!
    private var progressView: UIProgressView!
    private var offlineView: UIView?
    private var progressObservation: NSKeyValueObservation?
    private var pendingPickerCallback: (([URL]?) -> Void)?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.973, green: 0.976, blue: 1.0, alpha: 1)
        setupWebView()
        loadServer()
    }

    // MARK: - Web view setup

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.userContentController.add(WeakScriptMessageHandler(self), name: "saveBlob")
        config.userContentController.addUserScript(
            WKUserScript(
                source: Self.blobHookJS,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: false
            )
        )

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.translatesAutoresizingMaskIntoConstraints = false
        wv.allowsBackForwardNavigationGestures = true
        wv.scrollView.alwaysBounceVertical = true
        wv.backgroundColor = view.backgroundColor

        let refresh = UIRefreshControl()
        refresh.tintColor = Self.brandStart
        refresh.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        wv.scrollView.refreshControl = refresh

        wv.navigationDelegate = self
        wv.uiDelegate = self

        view.addSubview(wv)

        let pv = UIProgressView(progressViewStyle: .bar)
        pv.translatesAutoresizingMaskIntoConstraints = false
        pv.progressTintColor = Self.brandStart
        pv.trackTintColor = .clear
        view.addSubview(pv)

        NSLayoutConstraint.activate([
            wv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            wv.topAnchor.constraint(equalTo: view.topAnchor),
            wv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            pv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            pv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            pv.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
        ])

        progressObservation = wv.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            guard let value = change.newValue else { return }
            DispatchQueue.main.async {
                self?.progressView.isHidden = value >= 1.0
                self?.progressView.setProgress(Float(value), animated: true)
            }
        }

        webView = wv
        progressView = pv
    }

    private func loadServer() {
        offlineView?.removeFromSuperview()
        offlineView = nil
        progressView.isHidden = false
        let request = URLRequest(
            url: Self.serverURL,
            cachePolicy: .useProtocolCachePolicy,
            timeoutInterval: 30
        )
        webView.load(request)
    }

    @objc private func pullToRefresh() {
        loadServer()
    }

    // MARK: - Sharing / downloads

    /// Presents the iOS share sheet with a downloaded/generated file
    /// (Save to Files, AirDrop, print, etc. — iOS's standard "download").
    private func shareFile(at url: URL) {
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = view
        vc.popoverPresentationController?.sourceRect = CGRect(
            x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1
        )
        present(vc, animated: true)
    }

    /// Fetches a file URL with URLSession and offers it via the share sheet.
    /// Used for plain downloads (e.g. the Android .apk link) so iOS gets a
    /// proper "Save to Files" flow instead of a failed navigation.
    private func downloadAndShare(_ url: URL?) {
        guard let url else { return }
        let task = URLSession.shared.downloadTask(with: url) { [weak self] localURL, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let localURL, error == nil {
                    let name = response?.suggestedFilename ?? url.lastPathComponent
                    let dest = FileManager.default.temporaryDirectory
                        .appendingPathComponent(name.replacingOccurrences(of: "/", with: "-"))
                    try? FileManager.default.removeItem(at: dest)
                    do {
                        try FileManager.default.moveItem(at: localURL, to: dest)
                        self.shareFile(at: dest)
                    } catch {
                        self.showDownloadError(error)
                    }
                } else {
                    self.showDownloadError(error)
                }
            }
        }
        task.resume()
    }

    private func showDownloadError(_ error: Error?) {
        let alert = UIAlertController(
            title: "Download failed",
            message: error?.localizedDescription ?? "Please try again.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    // MARK: - Offline screen (locked build: only "Try Again")

    private func showOffline() {
        guard offlineView == nil else { return }
        webView.scrollView.refreshControl?.endRefreshing()

        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.backgroundColor = .systemBackground

        let tile = GradientTileView()
        tile.translatesAutoresizingMaskIntoConstraints = false
        tile.layer.cornerRadius = 24
        tile.layer.masksToBounds = true

        let glyph = UILabel()
        glyph.text = "J"
        glyph.font = .systemFont(ofSize: 44, weight: .black)
        glyph.textColor = .white
        glyph.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = "Can't reach the server"
        title.font = .systemFont(ofSize: 20, weight: .bold)
        title.textColor = .label
        title.textAlignment = .center
        title.translatesAutoresizingMaskIntoConstraints = false

        let message = UILabel()
        message.text = "Can't reach \(Self.serverHost) right now. Check your internet "
            + "connection, then try again — the app reconnects automatically once the "
            + "server is back."
        message.font = .systemFont(ofSize: 14)
        message.textColor = .secondaryLabel
        message.textAlignment = .center
        message.numberOfLines = 0
        message.translatesAutoresizingMaskIntoConstraints = false

        var config = UIButton.Configuration.filled()
        config.title = "Try Again"
        config.baseBackgroundColor = Self.brandStart
        config.cornerStyle = .large
        let button = UIButton(configuration: config)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(tryAgainTapped), for: .touchUpInside)

        container.addSubview(tile)
        tile.addSubview(glyph)
        container.addSubview(title)
        container.addSubview(message)
        container.addSubview(button)
        view.addSubview(container)

        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            container.topAnchor.constraint(equalTo: view.topAnchor),
            container.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            tile.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            tile.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -96),
            tile.widthAnchor.constraint(equalToConstant: 96),
            tile.heightAnchor.constraint(equalToConstant: 96),
            glyph.centerXAnchor.constraint(equalTo: tile.centerXAnchor),
            glyph.centerYAnchor.constraint(equalTo: tile.centerYAnchor, constant: 2),

            title.topAnchor.constraint(equalTo: tile.bottomAnchor, constant: 24),
            title.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            title.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32),

            message.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 12),
            message.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            message.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32),

            button.topAnchor.constraint(equalTo: message.bottomAnchor, constant: 28),
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32),
            button.heightAnchor.constraint(equalToConstant: 52),
        ])

        offlineView = container
    }

    @objc private func tryAgainTapped() {
        loadServer()
    }

    // MARK: - Blob bridge

    /// The web app exports some artifacts client-side (CSV, Markdown…) via
    /// blob: URLs, which WKWebView cannot download on its own. This script
    /// (mirrored from the Android client) catches those clicks and streams
    /// the bytes to the `saveBlob` handler below, which offers them through
    /// the iOS share sheet.
    private static let blobHookJS = """
    (function(){if(window.__jeduBlobHooked)return;window.__jeduBlobHooked=true;
    document.addEventListener('click',function(e){
    var t=e.target;var a=(t&&t.closest)?t.closest('a[href^="blob:"]'):null;
    if(!a)return;e.preventDefault();e.stopPropagation();
    var name=a.getAttribute('download')||'jeduai-export.bin';
    fetch(a.href).then(function(r){return r.blob()}).then(function(b){
    var fr=new FileReader();fr.onload=function(){
    var d=String(fr.result).split(',')[1]||'';
    window.webkit.messageHandlers.saveBlob.postMessage(
    {name:name,mime:(b.type||'application/octet-stream'),b64:d});
    };fr.readAsDataURL(b)})},true)})();
    """
}

// MARK: - WKNavigationDelegate

extension ViewController: WKNavigationDelegate {

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // Links flagged for download (e.g. a `download` attribute): cancel the
        // WebKit download path and fetch via URLSession so iOS gets a share sheet.
        if navigationAction.shouldPerformDownload {
            decisionHandler(.cancel)
            downloadAndShare(navigationAction.request.url)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "http" || scheme == "https" {
            let host = url.host?.lowercased() ?? ""
            if !host.isEmpty && host != Self.serverHost {
                // External site -> open in Safari (same behaviour as Android).
                decisionHandler(.cancel)
                UIApplication.shared.open(url)
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if !navigationResponse.response.canShowMIMEType {
            // Non-displayable file (e.g. the Android .apk) -> fetch + share sheet.
            decisionHandler(.cancel)
            downloadAndShare(navigationResponse.response.url)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.scrollView.refreshControl?.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleNavigationError(error)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisional navigation: WKNavigation!,
        withError error: Error
    ) {
        handleNavigationError(error)
    }

    private func handleNavigationError(_ error: Error) {
        webView.scrollView.refreshControl?.endRefreshing()
        let ns = error as NSError
        guard ns.code != NSURLErrorCancelled else { return }
        // Treat it as "offline" only when the app has nothing to show
        // (main-frame failure) — same behaviour as the Android client.
        let currentHost = webView.url?.host?.lowercased()
        if currentHost == nil || currentHost != Self.serverHost {
            showOffline()
        }
    }
}

// MARK: - WKUIDelegate (file uploads)

extension ViewController: WKUIDelegate {

    /// File uploads — document reader, media studio, notebook sources, etc.
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        pendingPickerCallback = completionHandler
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.item], asCopy: true)
        picker.allowsMultipleSelection = parameters.allowsMultipleSelection
        picker.delegate = self
        present(picker, animated: true)
    }
}

extension ViewController: UIDocumentPickerDelegate {

    func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        pendingPickerCallback?(urls)
        pendingPickerCallback = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingPickerCallback?(nil)
        pendingPickerCallback = nil
    }
}

// MARK: - Blob save messages

extension ViewController: WKScriptMessageHandler {

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard
            message.name == "saveBlob",
            let body = message.body as? [String: Any],
            let b64 = body["b64"] as? String,
            let data = Data(base64Encoded: b64)
        else { return }

        var name = (body["name"] as? String) ?? "jeduai-export.bin"
        name = name.replacingOccurrences(of: "/", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { name = "jeduai-export.bin" }

        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
            shareFile(at: url)
        } catch {
            showDownloadError(error)
        }
    }
}

/// Breaks the WKUserContentController retain cycle (it holds handlers strongly).
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(_ delegate: WKScriptMessageHandler) {
        self.delegate = delegate
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

/// Rounded square with the JeduAI brand gradient (matches the web app tile).
private final class GradientTileView: UIView {

    override class var layerClass: AnyClass { CAGradientLayer.self }
    private var gradientLayer: CAGradientLayer { layer as! CAGradientLayer }

    override init(frame: CGRect) {
        super.init(frame: frame)
        gradientLayer.colors = [ViewController.brandStart.cgColor, ViewController.brandEnd.cgColor]
        gradientLayer.startPoint = CGPoint(x: 0, y: 0)
        gradientLayer.endPoint = CGPoint(x: 1, y: 1)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }
}
