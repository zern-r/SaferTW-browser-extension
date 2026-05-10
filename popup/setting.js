document.getElementById('current-year').textContent = new Date().getFullYear();

function update_settings(){
	chrome.storage.local.set({
        UserName: $$$("input#input_UserName").val(),
        UserID: $$$("input#input_UserID").val(),
        UserEmail: $$$("input#input_UserEmail").val(),
        UserPhone: $$$("input#input_UserPhone").val(),
        UserAddress: $$$("input#input_UserAddress").val(),
	});
    console.log("[info]使用者設定更新完成");
}

function restore_options() {
	chrome.storage.local.get({
		UserName: "",
        UserID: "",
        UserEmail: "",
        UserPhone: "",
        UserAddress: "",
	}, function (items) {
		console.log("[info]讀取使用者設定");
		//console.log(items);
        $$$("input#input_UserName").val(items.UserName);
        $$$("input#input_UserID").val(items.UserID);
        $$$("input#input_UserEmail").val(items.UserEmail);
        $$$("input#input_UserPhone").val(items.UserPhone);
        $$$("input#input_UserAddress").val(items.UserAddress);
	});
};

$$$(function() {
    restore_options();
});

$$$("#save_input").click(function() {
	update_settings();
    swal("成功儲存");
});

