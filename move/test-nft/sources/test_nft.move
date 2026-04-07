module test_nft::test_nft {
    use std::string::String;
    use sui::display;
    use sui::package;

    /// One-time witness for module init
    public struct TEST_NFT has drop {}

    /// A simple NFT with Display metadata — used for testing Personal Join
    public struct TestNft has key, store {
        id: UID,
        name: String,
        image_url: String,
        description: String,
    }

    fun init(otw: TEST_NFT, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);
        let mut d = display::new<TestNft>(&publisher, ctx);
        d.add(b"name".to_string(), b"{name}".to_string());
        d.add(b"image_url".to_string(), b"{image_url}".to_string());
        d.add(b"description".to_string(), b"{description}".to_string());
        d.update_version();
        transfer::public_transfer(publisher, ctx.sender());
        transfer::public_transfer(d, ctx.sender());
    }

    public entry fun mint(
        name: String,
        image_url: String,
        description: String,
        ctx: &mut TxContext,
    ) {
        transfer::public_transfer(
            TestNft {
                id: object::new(ctx),
                name,
                image_url,
                description,
            },
            ctx.sender(),
        );
    }
}
