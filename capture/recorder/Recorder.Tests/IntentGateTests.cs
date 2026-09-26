using Xunit;
using Pdt.Recorder;

namespace Pdt.Recorder.Tests;

// Pins IntentGate: the recorder writes what the user acted on, never what an
// application does by itself. Each test replays a synthetic UI Automation
// sequence (focus changes, then value, selection or toggle events) modelled
// on the live recordings of 2026-09-26 (lane LF-SME, findings 3, 6, 11, 13).
// File Explorer is never recorded for this: its navigation pane names the
// owner's folders, so finding 3 is pinned here instead.
public class IntentGateTests {
    private static readonly DateTime T0 = new(2026, 9, 26, 12, 0, 0, DateTimeKind.Utc);
    private static DateTime At(double seconds) => T0.AddSeconds(seconds);

    private static ElementInfo El(int pid, string rid, string? aid, string? name, string type) =>
        new(pid, rid, aid, name, type);

    private static readonly IReadOnlyList<ElementInfo> None = Array.Empty<ElementInfo>();

    // Where UI Automation says the focus is now, and its ancestors (read lazily).
    private static Func<(ElementInfo?, Func<IReadOnlyList<ElementInfo>>)> Live(ElementInfo? focus, params ElementInfo[] ancestors) =>
        () => (focus, () => ancestors);

    // The element under the mouse pointer, and its ancestors (read lazily).
    private static Func<(ElementInfo?, Func<IReadOnlyList<ElementInfo>>)> Pointer(ElementInfo? hit, params ElementInfo[] ancestors) =>
        () => (hit, () => ancestors);

    private static Func<IReadOnlyList<ElementInfo>> Ancestors(params ElementInfo[] ancestors) => () => ancestors;

    private static readonly Func<bool> Yes = () => true;
    private static readonly Func<bool> No = () => false;

    // ---- Finding 3: File Explorer's navigation pane ----------------------

    private const int Explorer = 900;
    private static readonly ElementInfo ItemsView = El(Explorer, "42-1", "", "Items View", "List");
    private static readonly ElementInfo ScanFile = El(Explorer, "42-7", "", "scan-0001.pdf", "ListItem");
    private static readonly ElementInfo RenameBox = El(Explorer, "42-9", "1001", "Name", "Edit");
    private static readonly ElementInfo NavTree = El(Explorer, "42-2", "", "Navigation Pane", "Tree");

    private static ElementInfo NavItem(int i, string name) => El(Explorer, "42-2-" + i, "", name, "TreeItem");

    private static readonly string[] PaneNames = {
        "Home", "Gallery", "Desktop", "Downloads", "Documents", "Pictures", "Music", "Videos",
        "Invoices 2026", "Projects", "Contracts", "Personal Vault", "OneDrive", "This PC",
        "Local Disk (C:)", "Data (D:)", "Network", "Linux", "Recycle Bin", "Scans",
    };

    [Fact]
    public void Finding3_the_navigation_pane_refreshing_after_a_file_operation_writes_nothing() {
        var gate = new IntentGate();
        // The user works in the file list: clicks a file, renames it (F2, typing, Enter).
        gate.NoteFocus(ScanFile, new[] { ItemsView }, At(0));
        gate.NoteFocus(RenameBox, new[] { ScanFile, ItemsView }, At(1));
        gate.NoteFocus(ScanFile, new[] { ItemsView }, At(3));
        // Explorer refreshes its navigation pane: every pinned folder, drive and
        // OneDrive item reports a value change and a selection, 0.2 s to 1.5 s later.
        for (var i = 0; i < PaneNames.Length; i++) {
            var item = NavItem(i, PaneNames[i]);
            var at = At(3.2 + i * 0.07);
            Assert.False(gate.AcceptValue(item, at, Live(ScanFile, ItemsView), Yes, Yes),
                "a navigation pane name was kept: " + PaneNames[i]);
            Assert.False(gate.AcceptClick(item, at, Ancestors(NavTree), Pointer(ScanFile, ItemsView), Yes, Yes),
                "a navigation pane selection was kept: " + PaneNames[i]);
        }
    }

    [Fact]
    public void Finding3_a_navigation_pane_item_the_user_clicks_is_kept() {
        var gate = new IntentGate();
        gate.NoteFocus(ScanFile, new[] { ItemsView }, At(0));
        var invoices = NavItem(8, "Invoices 2026");
        // The click moves the focus to the item, and its selection and value follow.
        gate.NoteFocus(invoices, new[] { NavTree }, At(5));
        Assert.True(gate.AcceptClick(invoices, At(5.05), Ancestors(NavTree), Pointer(invoices), Yes, Yes));
        Assert.True(gate.AcceptValue(invoices, At(5.2), Live(invoices, NavTree), Yes, Yes));
        // Its neighbours, refreshed at the same moment, are still left out.
        Assert.False(gate.AcceptValue(NavItem(9, "Projects"), At(5.3), Live(invoices, NavTree), Yes, Yes));
    }

    [Fact]
    public void Finding3_the_shell_never_gets_the_benefit_of_the_doubt() {
        // Even before Explorer reported any focus, and with Explorer in front,
        // a navigation pane value is not kept: the shell always reports focus.
        var gate = new IntentGate();
        Assert.False(gate.AcceptValue(NavItem(3, "Downloads"), At(1), Live(null), Yes, Yes));
    }

    // ---- Finding 6: render-time values and echoes -------------------------

    private const int Chrome = 500;
    private static readonly ElementInfo SelectButton = El(Chrome, "7-100", "", "Select", "Button");
    private static readonly ElementInfo Page = El(Chrome, "7-1", "RootWebArea", "New order for Contoso Ltd - Order Desk", "Document");
    private static readonly ElementInfo Product = El(Chrome, "7-20", "ord-product", "Product", "ComboBox");
    private static readonly ElementInfo ProductList = El(Chrome, "7-21", "", "", "List");
    private static readonly ElementInfo OptionLaptop = El(Chrome, "7-22", "", "Laptop stand LS-200", "ListItem");
    private static readonly ElementInfo Quantity = El(Chrome, "7-30", "ord-qty", "Quantity", "Edit");
    private static readonly ElementInfo Notes = El(Chrome, "7-40", "ord-notes", "Notes", "Edit");
    private static readonly ElementInfo NotesSecondProvider = El(Chrome, "9-40", "", "Notes", "Edit");

    [Fact]
    public void Finding6_a_screen_filling_its_fields_as_it_loads_writes_nothing() {
        var gate = new IntentGate();
        // The user clicks Select on the lookup screen; the order screen loads.
        gate.NoteFocus(SelectButton, None, At(0));
        gate.NoteFocus(Page, None, At(0.14));
        // Its select reports its default option (routed to the combo box) and
        // its fields their initial values.
        Assert.False(gate.AcceptValue(Product, At(0.2), Live(Page), Yes, No));
        Assert.False(gate.AcceptValue(Quantity, At(0.21), Live(Page), Yes, No));
        Assert.False(gate.AcceptClick(OptionLaptop, At(0.21), Ancestors(ProductList, Product, Page), Pointer(SelectButton), Yes, No));
    }

    [Fact]
    public void Finding6_a_choice_in_an_open_drop_down_counts_for_its_combo_box() {
        var gate = new IntentGate();
        gate.NoteFocus(Page, None, At(0));
        // The click opens the list: the focus goes to the highlighted option.
        gate.NoteFocus(OptionLaptop, new[] { ProductList, Product }, At(1.3));
        Assert.True(gate.AcceptValue(Product, At(1.8), Live(OptionLaptop, ProductList, Product), Yes, No));
        // Enter closes it; the focus is back on the combo box.
        gate.NoteFocus(Product, new[] { Page }, At(2.6));
        Assert.True(gate.AcceptValue(Product, At(2.61), Live(Product, Page), Yes, No));
    }

    // The focus is followed on UI Automation's one callback thread's time, so
    // a focus change must cost little: its ancestors are read only when a
    // rule needs them (a combo box around its open list), and once.
    [Fact]
    public void Ancestors_are_read_only_when_a_rule_needs_them_and_only_once() {
        var gate = new IntentGate();
        var reads = 0;
        gate.NoteFocus(OptionLaptop, () => { reads++; return new[] { ProductList, Product }; }, At(0));
        Assert.True(gate.AcceptValue(OptionLaptop, At(0.1), Live(null), Yes, No));
        Assert.Equal(0, reads);
        Assert.True(gate.AcceptValue(Product, At(0.2), Live(null), Yes, No));
        Assert.True(gate.AcceptValue(Product, At(0.3), Live(null), Yes, No));
        Assert.Equal(1, reads);
    }

    [Fact]
    public void Typing_counts_through_chromes_second_focus_report_without_the_id() {
        var gate = new IntentGate();
        gate.NoteFocus(Notes, new[] { Page }, At(0));
        gate.NoteFocus(NotesSecondProvider, None, At(0.06));
        // Keystrokes for four seconds: the field keeps counting as focused.
        for (var s = 0.6; s < 4.6; s += 0.5) {
            Assert.True(gate.AcceptValue(Notes, At(s), Live(NotesSecondProvider), Yes, No), "at " + s);
        }
        // A field the user never went to does not.
        Assert.False(gate.AcceptValue(Quantity, At(4.7), Live(NotesSecondProvider), Yes, No));
    }

    private const int Excel = 700;
    private static readonly ElementInfo CellA2 = El(Excel, "5-2-1", "A2", "A2", "DataItem");
    private static readonly ElementInfo CellB2 = El(Excel, "5-2-2", "B2", "B2", "DataItem");
    private static readonly ElementInfo CellEdit = El(Excel, "5-9", "CellEdit", "Edit Cell", "Edit");
    private static readonly ElementInfo Bold = El(Excel, "5-80", "Bold", "Bold", "Button");
    private static readonly ElementInfo BottomAlign = El(Excel, "5-81", "AlignBottomExcel", "Bottom Align", "Button");
    private static readonly ElementInfo FontCombo = El(Excel, "5-82", "Font", "Font", "ComboBox");

    [Fact]
    public void Finding6_the_office_ribbon_echoing_the_selected_cell_writes_nothing() {
        var gate = new IntentGate();
        gate.NoteFocus(CellA2, None, At(0));
        // Selecting a cell sets the ribbon's toggles and font box to its format.
        Assert.False(gate.AcceptClick(Bold, At(0.07), Ancestors(), Pointer(CellA2), Yes, No));
        Assert.False(gate.AcceptClick(BottomAlign, At(0.6), Ancestors(), Pointer(CellA2), Yes, No));
        Assert.False(gate.AcceptValue(FontCombo, At(0.9), Live(CellA2), Yes, No));
    }

    [Fact]
    public void Finding6_a_ribbon_toggle_the_user_clicks_counts_though_it_takes_no_focus() {
        var gate = new IntentGate();
        gate.NoteFocus(CellA2, None, At(0));
        // The click lands on the button's icon; the focus stays in the sheet.
        var icon = El(Excel, "5-80-1", "", "", "Image");
        Assert.True(gate.AcceptClick(Bold, At(2.1), Ancestors(), Pointer(icon, Bold), Yes, No));
    }

    [Fact]
    public void An_excel_cell_counts_as_the_tab_commits_it_and_not_long_after() {
        var gate = new IntentGate();
        gate.NoteFocus(CellA2, None, At(0));
        gate.NoteFocus(CellEdit, None, At(0.6));     // typing into the cell
        gate.NoteFocus(CellA2, None, At(2.0));       // Tab: the cell again, then its value
        Assert.True(gate.AcceptValue(CellA2, At(2.08), Live(CellA2), Yes, No));
        gate.NoteFocus(CellB2, None, At(2.1));
        // The value can come right after the focus moved on.
        Assert.True(gate.AcceptValue(CellA2, At(2.15), Live(CellB2), Yes, No));
        // But not seconds later: that is not the user's typing any more.
        Assert.False(gate.AcceptValue(CellA2, At(4.5), Live(CellB2), Yes, No));
    }

    // ---- Finding 11: the desktop behind the windows -----------------------

    [Fact]
    public void Finding11_a_desktop_icon_selected_behind_the_windows_writes_nothing() {
        var gate = new IntentGate();
        gate.NoteFocus(Product, new[] { Page }, At(0));
        var desktopIcon = El(Explorer, "3-81", "ListViewItem-81", "Black Desert", "ListItem");
        var folderView = El(Explorer, "3-1", "1", "FolderView", "List");
        var progman = El(Explorer, "3-0", "", "Program Manager", "Pane");
        Assert.False(gate.AcceptClick(desktopIcon, At(13), Ancestors(folderView, progman),
            Pointer(Product, Page), No, Yes));
    }

    // ---- Finding 13: Excel's formula AutoComplete -------------------------

    [Fact]
    public void Finding13_the_formula_autocomplete_list_writes_nothing() {
        var gate = new IntentGate();
        gate.NoteFocus(CellEdit, None, At(0));
        var popupList = El(Excel, "6-1", "", "", "List");
        foreach (var fn in new[] { "DATE", "EDATE", "SCAN", "SUBSTITUTE", "SUM", "F.DIST" }) {
            var item = El(Excel, "6-1-" + fn, "", fn, "ListItem");
            Assert.False(gate.AcceptClick(item, At(0.4), Ancestors(popupList), Pointer(CellA2), Yes, No), fn);
        }
    }

    // ---- Containers, the fallback, identity -------------------------------

    [Fact]
    public void Keys_moving_the_selection_inside_a_focused_tab_strip_or_list_count() {
        var gate = new IntentGate();
        var tabs = El(300, "8-1", "12320", "Tabs", "Tab");
        var general = El(300, "8-2", "", "General", "TabItem");
        gate.NoteFocus(tabs, None, At(0));
        Assert.True(gate.AcceptClick(general, At(0.5), Ancestors(tabs), Pointer(null), Yes, No));
        // A document is not such a container: a list inside the focused page
        // does not count through it.
        gate.NoteFocus(Page, None, At(1));
        Assert.False(gate.AcceptClick(OptionLaptop, At(1.2), Ancestors(ProductList, Product, Page), Pointer(null), Yes, No));
    }

    [Fact]
    public void A_program_that_never_reports_its_focus_keeps_what_it_reports_while_in_front() {
        var gate = new IntentGate();
        var grid = El(800, "4-1", "", "", "Custom");
        Assert.True(gate.AcceptValue(grid, At(1), Live(null), Yes, No));
        Assert.True(gate.AcceptClick(grid, At(1), Ancestors(), Pointer(null), Yes, No));
        // Behind the others it is never the user's work.
        Assert.False(gate.AcceptValue(grid, At(1), Live(null), No, No));
        // A window-level focus says nothing: still no report.
        gate.NoteFocus(El(800, "4-0", "", "Main", "Window"), None, At(2));
        Assert.True(gate.AcceptValue(grid, At(3), Live(null), Yes, No));
        // Once it reports a field, the focus rule applies to it.
        gate.NoteFocus(El(800, "4-2", "txtName", "Name", "Edit"), None, At(4));
        Assert.False(gate.AcceptValue(grid, At(5), Live(null), Yes, No));
    }

    [Fact]
    public void Same_element_by_runtime_id_by_id_and_type_or_by_label_when_one_side_has_no_id() {
        Assert.True(IntentGate.Same(El(1, "1-2", "x", "X", "Edit"), El(1, "1-2", "y", "Y", "Button")));
        Assert.True(IntentGate.Same(El(1, "1-2", "cust", "Customer", "Edit"), El(1, "9-9", "cust", "", "Edit")));
        Assert.True(IntentGate.Same(El(1, "1-2", "ord-notes", "Notes", "Edit"), El(1, "9-9", "", "Notes", "Edit")));
        // Two ids that differ are two controls, even with one label.
        Assert.False(IntentGate.Same(El(1, "1-2", "a", "Name", "Edit"), El(1, "9-9", "b", "Name", "Edit")));
        // A label alone, on different types, is not the same control.
        Assert.False(IntentGate.Same(El(1, "1-2", "", "Documents", "TreeItem"), El(1, "9-9", "", "Documents", "ListItem")));
        // Another program is never the same control.
        Assert.False(IntentGate.Same(El(1, "1-2", "a", "A", "Edit"), El(2, "1-2", "a", "A", "Edit")));
    }
}
